import "server-only";
import { prisma } from "@/lib/db";
import { paginatePages } from "@/lib/conexa/client";
import { monthBounds } from "@/lib/dates";
import { roundMoney, sum, type Money } from "@/lib/money";
import { contaComoReceita, valorFaturado } from "@/lib/metrics/receita";
import { mapCharge } from "@/lib/conexa/mappers";
import type { ConexaCharge } from "@/lib/conexa/types";

/**
 * Reconciliação: o espelho local bate com o Conexa?
 *
 * ⚠ **A janela é por VENCIMENTO, não por emissão.** Medido contra a API: os
 * únicos filtros de data que `/charges` aceita são `dueDateFrom/To`,
 * `competenceDateFrom/To` e `paymentDateFrom/To`. **Não existe filtro por
 * `createdAt`** — e a API não ignora o parâmetro desconhecido: ela devolve
 * **zero registros**.
 *
 * Isso derrubou a primeira versão desta função, que filtrava por
 * `createdAtFrom/To`. O remoto vinha sempre vazio e, com o espelho também
 * vazio, a reconciliação anunciava **"✓ bate"** — um falso verde, que num
 * verificador é pior que não ter verificador nenhum.
 *
 * Como a receita é apurada por EMISSÃO e a emissão não é filtrável, esta função
 * não prova o total de um mês de emissão. O que ela prova — e é o que importa —
 * é que **o espelho contém os mesmos registros, com os mesmos valores**, num
 * conjunto que os dois lados sabem selecionar. Espelho correto ⇒ receita
 * correta, e a receita é conferida contra a tela do Conexa separadamente.
 *
 * (Emissão e vencimento podem estar a meses de distância: medido em produção,
 * uma cobrança com vencimento em 26/01/2026 foi criada em 24/03/2025.)
 */

export interface Divergencia {
  chargeId: number;
  motivo: "faltando no espelho" | "sobrando no espelho" | "valor diferente";
  local?: string;
  remoto?: string;
}

export type VeredictoReconciliacao = "BATE" | "DIVERGE" | "NADA_A_CONFERIR";

export interface ResultadoReconciliacao {
  mesKey: string;
  janela: "vencimento";
  localTotal: string;
  localContagem: number;
  remotoTotal: string;
  remotoContagem: number;
  diferenca: string;
  veredicto: VeredictoReconciliacao;
  divergencias: Divergencia[];
  requisicoes: number;
  observacao?: string;
}

/**
 * Compara a janela de VENCIMENTO de um mês. Mesma régua dos dois lados: se o
 * predicado de exclusão divergisse entre o espelho e a conferência, o resultado
 * diria "bate" com os dois lados errados do mesmo jeito.
 */
export async function reconciliarMes(
  mesKey: string,
  signal?: AbortSignal,
): Promise<ResultadoReconciliacao> {
  const { fromDate, toDateExclusive } = monthBounds(mesKey);
  const ultimoDia = new Date(toDateExclusive.getTime() - 86_400_000);

  const locais = await prisma.charge.findMany({
    where: { dueDate: { gte: fromDate, lt: toDateExclusive } },
    select: { conexaId: true, amount: true, currentAmount: true, status: true, cancelDate: true },
  });
  const localPorId = new Map(locais.map((c) => [c.conexaId, c]));
  const localReconhecidas = locais.filter((c) => contaComoReceita(c as never));
  const localTotal = roundMoney(sum(localReconhecidas.map((c) => valorFaturado(c as never).toString())));

  const remotos = new Map<number, { valor: Money; conta: boolean }>();
  let requisicoes = 0;

  for await (const { itens } of paginatePages<ConexaCharge>(
    "charges",
    // Filtros REAIS da API. Inclusivos nas duas pontas.
    { dueDateFrom: iso(fromDate), dueDateTo: iso(ultimoDia) },
    { signal },
  )) {
    requisicoes++;
    for (const bruto of itens) {
      const m = mapCharge(bruto);
      if (!m) continue;
      remotos.set(m.conexaId, {
        valor: valorFaturado(m as never),
        conta: contaComoReceita(m as never),
      });
    }
  }

  const remotoReconhecidas = [...remotos.values()].filter((r) => r.conta);
  const remotoTotal = roundMoney(sum(remotoReconhecidas.map((r) => r.valor.toString())));

  const divergencias: Divergencia[] = [];
  for (const [id, r] of remotos) {
    const l = localPorId.get(id);
    if (!l) {
      if (r.conta) divergencias.push({ chargeId: id, motivo: "faltando no espelho", remoto: r.valor.toFixed(2) });
      continue;
    }
    const vl = valorFaturado(l as never);
    if (!vl.equals(r.valor)) {
      divergencias.push({ chargeId: id, motivo: "valor diferente", local: vl.toFixed(2), remoto: r.valor.toFixed(2) });
    }
  }
  for (const c of locais) {
    if (!remotos.has(c.conexaId) && contaComoReceita(c as never)) {
      divergencias.push({ chargeId: c.conexaId, motivo: "sobrando no espelho", local: valorFaturado(c as never).toFixed(2) });
    }
  }

  const diferenca = localTotal.minus(remotoTotal);

  // ⚠ Conjunto remoto VAZIO nunca é "bate".
  //
  // Zero do lado do Conexa quase sempre significa que a consulta não trouxe o
  // que devia — filtro errado, permissão, indisponibilidade — e não que o mês
  // não teve cobrança. Com o espelho também vazio, chamar isso de "bate" emite
  // um atestado de correção sobre uma conferência que não aconteceu. Foi
  // exatamente o modo de falha da primeira versão.
  let veredicto: VeredictoReconciliacao;
  let observacao: string | undefined;
  if (remotos.size === 0) {
    veredicto = "NADA_A_CONFERIR";
    observacao =
      locais.length > 0
        ? `O Conexa devolveu ZERO cobranças com vencimento em ${mesKey}, mas o espelho tem ${locais.length}. Isso é divergência ou falha de consulta — não é "bate".`
        : `O Conexa devolveu zero cobranças e o espelho também. Nada foi conferido: não confunda com "bate".`;
  } else if (diferenca.isZero() && localReconhecidas.length === remotoReconhecidas.length) {
    veredicto = "BATE";
  } else {
    veredicto = "DIVERGE";
  }

  return {
    mesKey,
    janela: "vencimento",
    localTotal: localTotal.toFixed(2),
    localContagem: localReconhecidas.length,
    remotoTotal: remotoTotal.toFixed(2),
    remotoContagem: remotoReconhecidas.length,
    diferenca: diferenca.toFixed(2),
    veredicto,
    divergencias: divergencias.slice(0, 50),
    requisicoes,
    observacao,
  };
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
