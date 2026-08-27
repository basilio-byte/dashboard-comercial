import "server-only";
import { prisma } from "@/lib/db";
import { keyToUtcDate, todayKey, currentMonthKey, ultimosMesesFechados } from "@/lib/dates";
import { money } from "@/lib/money";
import { estadoDoEspelho } from "@/lib/intel/completude";
import {
  ehSegmentoFiscal,
  ehSegmentoPrivativa,
  litoralReservouSala,
  marcoAtingido,
  quedaMesAMes,
  quedaPercentual,
  usoAvulsoAlto,
} from "./familias";
import { PARAMS } from "./avaliar";

/**
 * A FILA DE TODOS OS SINAIS — não só o excedente de horas.
 *
 * ⚠ O motivo desta função existir, medido em produção em 2026-08-27: numa
 * amostra de 10 clientes, **6 tinham sinal ativo** — regra 4 em dois, regra 8
 * em um, queda de receita em três. As regras estavam disparando o tempo todo.
 *
 * Mas o sinal só aparecia **abrindo cliente por cliente**, e o Radar mostrava
 * apenas o excedente. Com 5.630 clientes, isso é o mesmo que não existir:
 * ninguém abre 5.630 fichas para descobrir quem procurar.
 *
 * A pergunta do dono foi "por que os gatilhos não estão ligados?" — e a resposta
 * era que estavam, e o produto escondia. Um sinal que ninguém vê não é sinal.
 *
 * ⚠ Em LOTE, como a fila de excedente. Avaliar cliente a cliente daria N+1
 * sobre milhares de clientes e obrigaria a um corte — e corte foi exatamente o
 * defeito que fez a fila anterior enxergar 200 dos 5.244.
 */

export interface ItemDaFila {
  customerConexaId: number;
  nome: string | null;
  regra: string;
  nomeDaRegra: string;
  oferta: string;
  /** O número concreto que sustenta o sinal. */
  evidencia: string;
  /** Para ordenar entre regras diferentes: quanto maior, mais forte. */
  peso: number;
}

export interface FilaDeSinais {
  itens: ItemDaFila[];
  analisados: number;
  /** Contagem por regra, para o placar. */
  porRegra: Record<string, number>;
  /** Regras que não puderam ser avaliadas, com o motivo. */
  bloqueadas: Array<{ regra: string; motivo: string }>;
}

const fmtH = (v: { toFixed: (n: number) => string }) =>
  `${Number(v.toFixed(1))}h`.replace(".", ",");

export async function filaDeSinais(): Promise<FilaDeSinais> {
  const hoje = keyToUtcDate(todayKey());
  const mesAtual = currentMonthKey();
  const espelho = await estadoDoEspelho();

  const bloqueadas: Array<{ regra: string; motivo: string }> = [
    { regra: "2", motivo: "saldo derivado não conferido contra o Conexa" },
    { regra: "9", motivo: "saldo derivado não conferido contra o Conexa" },
  ];
  if (!espelho.horasConfiavel) {
    bloqueadas.push({ regra: "4", motivo: "espelho de reservas/contratos incompleto" });
    bloqueadas.push({ regra: "5", motivo: "espelho de reservas incompleto" });
    bloqueadas.push({ regra: "10", motivo: "espelho de reservas incompleto" });
  }

  // ── Carga em lote: cinco consultas para a base inteira ──────────────────
  const contratos = await prisma.contract.findMany({
    where: {
      isActive: true,
      customerConexaId: { not: null },
      OR: [{ endDate: null }, { endDate: { gte: hoje } }],
    },
    select: {
      conexaId: true,
      customerConexaId: true,
      planConexaId: true,
      startDate: true,
      hourPlanQuotaRaw: true,
    },
  });
  const idsClientes = [...new Set(contratos.map((c) => c.customerConexaId!))];

  const [elegiveis, planos, categorias] = await Promise.all([
    prisma.customer.findMany({
      where: { conexaId: { in: idsClientes }, isActive: true, isBlocked: false },
      select: { conexaId: true, name: true },
    }),
    prisma.plan.findMany({
      select: { conexaId: true, serviceCategoryConexaId: true, horasInclusasMes: true },
    }),
    prisma.serviceCategory.findMany({ select: { conexaId: true, name: true } }),
  ]);
  const nomePor = new Map(elegiveis.map((c) => [c.conexaId, c.name]));
  const planoPor = new Map(planos.map((p) => [p.conexaId, p]));
  const catPor = new Map(categorias.map((c) => [c.conexaId, c.name ?? ""]));
  const categoriaDo = (planConexaId: number | null) => {
    const p = planConexaId !== null ? planoPor.get(planConexaId) : undefined;
    return p?.serviceCategoryConexaId != null ? catPor.get(p.serviceCategoryConexaId) ?? "" : "";
  };

  const porCliente = new Map<number, typeof contratos>();
  for (const c of contratos) {
    if (!nomePor.has(c.customerConexaId!)) continue; // gate de elegibilidade
    const l = porCliente.get(c.customerConexaId!) ?? [];
    l.push(c);
    porCliente.set(c.customerConexaId!, l);
  }
  const alvos = [...porCliente.keys()];

  // Reservas: só as do mês corrente (regras 4 e 10) e a primeira de cada
  // cliente (regra 5). Duas consultas em vez de trazer 21 mil linhas.
  const inicioMes = keyToUtcDate(`${mesAtual}-01`);
  const [reservasDoMes, primeiras, mensais] = await Promise.all([
    prisma.roomBooking.findMany({
      where: {
        customerConexaId: { in: alvos },
        isActive: true,
        cancellationReason: null,
        dataLocal: { gte: inicioMes },
      },
      select: { customerConexaId: true, horas: true },
    }),
    prisma.roomBooking.groupBy({
      by: ["customerConexaId"],
      where: { customerConexaId: { in: alvos }, isActive: true, cancellationReason: null },
      _min: { dataLocal: true },
    }),
    prisma.customerMonthlyRevenue.findMany({
      where: { customerConexaId: { in: alvos }, mesKey: { in: ultimosMesesFechados(12) } },
      select: { customerConexaId: true, mesKey: true, receita: true },
    }),
  ]);

  const horasNoMesPor = new Map<number, ReturnType<typeof money>>();
  const reservasNoMesPor = new Map<number, number>();
  for (const b of reservasDoMes) {
    if (b.customerConexaId === null) continue;
    horasNoMesPor.set(
      b.customerConexaId,
      (horasNoMesPor.get(b.customerConexaId) ?? money(0)).plus(money(b.horas?.toString() ?? 0)),
    );
    reservasNoMesPor.set(b.customerConexaId, (reservasNoMesPor.get(b.customerConexaId) ?? 0) + 1);
  }
  const primeiraPor = new Map(
    primeiras.filter((g) => g.customerConexaId !== null).map((g) => [g.customerConexaId!, g._min.dataLocal]),
  );
  const seriePor = new Map<number, Array<{ mesKey: string; valor: ReturnType<typeof money> }>>();
  for (const m of mensais) {
    const l = seriePor.get(m.customerConexaId) ?? [];
    l.push({ mesKey: m.mesKey, valor: money(m.receita.toString()) });
    seriePor.set(m.customerConexaId, l);
  }

  // ── Avaliação, em memória ───────────────────────────────────────────────
  const itens: ItemDaFila[] = [];
  const add = (
    id: number,
    regra: string,
    nomeDaRegra: string,
    oferta: string,
    evidencia: string,
    peso: number,
  ) => itens.push({ customerConexaId: id, nome: nomePor.get(id) ?? null, regra, nomeDaRegra, oferta, evidencia, peso });

  const MARCOS = [
    { regra: "1", nome: "Fiscal completa 11 meses", meses: 11, oferta: "plano Bianual", privativa: false },
    { regra: "6", nome: "Privativa completa 1 mês", meses: 1, oferta: "Registro de Marca", privativa: true },
    { regra: "7", nome: "Privativa completa 2 meses", meses: 2, oferta: "SeaBox como benefício", privativa: true },
    { regra: "8", nome: "Privativa completa 6 meses", meses: 6, oferta: "Panteão", privativa: true },
  ];

  for (const [id, lista] of porCliente) {
    const temCota = lista.some((c) => {
      const p = c.planConexaId !== null ? planoPor.get(c.planConexaId) : undefined;
      return p?.horasInclusasMes != null || Array.isArray(c.hourPlanQuotaRaw);
    });

    // MARCO_CONTRATO — 1, 6, 7, 8
    for (const m of MARCOS) {
      const alvo = lista.find((c) => {
        if (!c.startDate) return false;
        const cat = categoriaDo(c.planConexaId);
        if (m.privativa ? !ehSegmentoPrivativa(cat) : !ehSegmentoFiscal(cat)) return false;
        return marcoAtingido({
          inicio: c.startDate,
          meses: m.meses,
          hoje,
          toleranciaDias: PARAMS.toleranciaMarcoDias,
        });
      });
      if (alvo) add(id, m.regra, m.nome, m.oferta, `contrato #${alvo.conexaId}`, 50);
    }

    // USO_SEM_COTA — 4
    if (espelho.horasConfiavel) {
      const horas = horasNoMesPor.get(id) ?? money(0);
      if (usoAvulsoAlto({ temContratoComCota: temCota, horasNoMes: horas, limiarHoras: PARAMS.limiarHorasAvulso })) {
        add(id, "4", "Avulso com uso alto", "pacote de horas", `${fmtH(horas)} no mês, sem cota`, Number(horas) * 5);
      }

      // PRIMEIRO_EVENTO — 5
      const primeira = primeiraPor.get(id) ?? null;
      if (
        primeira &&
        primeira >= keyToUtcDate(PARAMS.primeiraReservaDesde) &&
        marcoAtingido({ inicio: primeira, meses: 0, hoje, toleranciaDias: PARAMS.toleranciaMarcoDias })
      ) {
        add(id, "5", "Primeira reserva de sala", "Endereço Fiscal + SeaBox", "estreou agora", 60);
      }

      // EVENTO_EM_SEGMENTO — 10
      const litoral = lista.some((c) => {
        if (!ehSegmentoFiscal(categoriaDo(c.planConexaId))) return false;
        const p = c.planConexaId !== null ? planoPor.get(c.planConexaId) : undefined;
        return p?.horasInclusasMes == null;
      });
      const nRes = reservasNoMesPor.get(id) ?? 0;
      if (litoralReservouSala({ temPlanoFiscalSemCota: litoral, reservasNoPeriodo: nRes })) {
        add(id, "10", "Litoral reserva sala", "Pacote de Horas ou Batial", `${nRes} reserva(s) no mês`, 40 + nRes);
      }
    }

    // TENDENCIA — 3 e a métrica do §1
    const serie = (seriePor.get(id) ?? []).sort((a, b) => a.mesKey.localeCompare(b.mesKey));
    const q = quedaMesAMes({ serie, quedasSeguidas: PARAMS.quedasSeguidas });
    if (q.disparou) {
      add(id, "3", "Padrão de compra irregular", "novo pacote", `${q.quedas} quedas seguidas`, 30 + q.quedas * 5);
    }
    const ult = serie.at(-1);
    const pen = serie.at(-2);
    if (ult && pen) {
      const pc = quedaPercentual({ atual: ult.valor, anterior: pen.valor, limiarPct: PARAMS.limiarQuedaPct });
      if (pc.disparou && pc.variacaoPct !== null) {
        add(id, "métrica", "Queda de receita", "olhar antes que o cliente saia",
          `${pc.variacaoPct.toFixed(1).replace(".", ",")}% em ${ult.mesKey}`, Math.abs(pc.variacaoPct));
      }
    }
  }

  const porRegra: Record<string, number> = {};
  for (const i of itens) porRegra[i.regra] = (porRegra[i.regra] ?? 0) + 1;

  return {
    itens: itens.sort((a, b) => b.peso - a.peso),
    analisados: porCliente.size,
    porRegra,
    bloqueadas,
  };
}
