import "server-only";
import { prisma } from "@/lib/db";
import { paginatePages } from "@/lib/conexa/client";
import { monthBounds } from "@/lib/dates";
import { money, roundMoney, sum, type Money } from "@/lib/money";
import { contaComoReceita, valorFaturado } from "@/lib/metrics/receita";
import { mapCharge } from "@/lib/conexa/mappers";
import type { ConexaCharge } from "@/lib/conexa/types";

/**
 * Reconciliação: o espelho local bate com o Conexa?
 *
 * O critério de aceite da Fase 1 é diferença de **R$ 0,00** e contagem 1:1 num
 * mês fechado. Um dashboard comercial que contradiz o financeiro em receita não
 * é "outro recorte" — é um dos dois errado, e ninguém sabe qual.
 *
 * ⚠ Custa requisições: varre o mês inteiro na API. Roda sob demanda, não em
 * laço automático, por causa do teto compartilhado (ADR-0002).
 */

export interface Divergencia {
  chargeId: number;
  motivo: "faltando no espelho" | "sobrando no espelho" | "valor diferente" | "mês diferente";
  local?: string;
  remoto?: string;
}

export interface ResultadoReconciliacao {
  mesKey: string;
  localTotal: string;
  localContagem: number;
  remotoTotal: string;
  remotoContagem: number;
  diferenca: string;
  bate: boolean;
  divergencias: Divergencia[];
  requisicoes: number;
}

/**
 * Compara um mês fechado. Usa a MESMA régua dos dois lados — se o predicado de
 * exclusão divergisse entre o espelho e a conferência, a reconciliação daria
 * "bate" com os dois lados errados do mesmo jeito.
 */
export async function reconciliarMes(mesKey: string, signal?: AbortSignal): Promise<ResultadoReconciliacao> {
  const { fromDate, toDateExclusive } = monthBounds(mesKey);

  const locais = await prisma.charge.findMany({
    where: { emissionDate: { gte: fromDate, lt: toDateExclusive } },
    select: {
      conexaId: true,
      amount: true,
      currentAmount: true,
      status: true,
      cancelDate: true,
    },
  });
  const localPorId = new Map(locais.map((c) => [c.conexaId, c]));
  const localReconhecidas = locais.filter((c) => contaComoReceita(c as never));
  const localTotal = roundMoney(sum(localReconhecidas.map((c) => valorFaturado(c as never).toString())));

  // Do lado do Conexa: varre o mês inteiro. A API não filtra por data de
  // emissão, então filtramos pela emissão derivada de `createdAt`, exatamente
  // como o espelho faz — senão a comparação seria entre réguas diferentes.
  const remotos = new Map<number, { valor: Money; conta: boolean }>();
  let requisicoes = 0;

  for await (const { itens } of paginatePages<ConexaCharge>(
    "charges",
    { createdAtFrom: isoDe(fromDate), createdAtTo: isoDe(toDateExclusive) },
    { signal },
  )) {
    requisicoes++;
    for (const bruto of itens) {
      const mapeado = mapCharge(bruto);
      if (!mapeado?.emissionDate) continue;
      // Só conta se a EMISSÃO cair no mês — a janela da API é por createdAt em
      // UTC, e a emissão é no relógio de parede: as bordas não coincidem.
      if (mapeado.emissionDate < fromDate || mapeado.emissionDate >= toDateExclusive) continue;
      remotos.set(mapeado.conexaId, {
        valor: valorFaturado(mapeado as never),
        conta: contaComoReceita(mapeado as never),
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
      divergencias.push({
        chargeId: id,
        motivo: "valor diferente",
        local: vl.toFixed(2),
        remoto: r.valor.toFixed(2),
      });
    }
  }
  for (const c of locais) {
    if (!remotos.has(c.conexaId) && contaComoReceita(c as never)) {
      divergencias.push({
        chargeId: c.conexaId,
        motivo: "sobrando no espelho",
        local: valorFaturado(c as never).toFixed(2),
      });
    }
  }

  const diferenca = localTotal.minus(remotoTotal);

  return {
    mesKey,
    localTotal: localTotal.toFixed(2),
    localContagem: localReconhecidas.length,
    remotoTotal: remotoTotal.toFixed(2),
    remotoContagem: remotoReconhecidas.length,
    diferenca: diferenca.toFixed(2),
    // Bate = zero centavo E contagem idêntica. Só o total batendo esconde duas
    // divergências que se cancelam.
    bate: diferenca.isZero() && localReconhecidas.length === remotoReconhecidas.length,
    divergencias: divergencias.slice(0, 50),
    requisicoes,
  };
}

function isoDe(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export { money };
