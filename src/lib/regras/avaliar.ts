import "server-only";
import { prisma } from "@/lib/db";
import { keyToUtcDate, todayKey, currentMonthKey, ultimosMesesFechados } from "@/lib/dates";
import { money } from "@/lib/money";
import { horasDoCliente } from "@/lib/intel/horas";
import {
  ehSegmentoFiscal,
  ehSegmentoPrivativa,
  litoralReservouSala,
  marcoAtingido,
  posseDoProduto,
  primeiraReserva,
  quedaMesAMes,
  quedaPercentual,
  usoAvulsoAlto,
} from "./familias";

/**
 * SINAIS AUTOMÁTICOS DE UM CLIENTE — a aba que o documento do Diego pede.
 *
 * §4.6: *"Sinais Automáticos: cada regra de negócio da seção 1, avaliada com os
 * dados reais do cliente (marcar como: gatilho ativo / não aplicável / dado
 * indisponível / ambíguo)"*.
 *
 * ⚠ Os quatro estados são os DELE, não meus. Em especial `AMBIGUO`, que ele
 * previu e que se encaixou em dois lugares que eu não esperava: cliente com
 * mais de um contrato com cota (a reserva não diz de qual balde a hora saiu) e
 * regra que ofertaria algo que o cliente pode já ter de cortesia, sem
 * mapeamento para confirmar.
 *
 * ⚠ **Isto NÃO dispara nada.** É a camada de avaliação, e a de disparo não
 * existe. Ver a tela por cliente — é lá que o vendedor lê e decide.
 */

export type EstadoSinal = "ATIVO" | "NAO_APLICAVEL" | "DADO_INDISPONIVEL" | "AMBIGUO";

export interface Sinal {
  /** "1".."10", "extra" (pedido do responsável) ou "métrica" (§1 do documento). */
  regra: string;
  nome: string;
  familia: string;
  oferta: string;
  estado: EstadoSinal;
  /** Por que este estado. É o que a tela mostra quando não está ativo. */
  motivo: string;
  /** O número concreto que sustenta o sinal, quando ele existe. */
  evidencia?: string;
}

/**
 * ⚠ PARÂMETROS, com valores de partida — não decisões.
 *
 * O documento fala em "cair X%", e o X é do cliente. Todos estes deveriam
 * morar numa tela de Configurações; até lá vivem aqui, num lugar só, com o
 * status declarado na própria tela.
 */
export const PARAMS = {
  /** O job roda uma vez por dia; sem folga, um marco perdido some para sempre. */
  toleranciaMarcoDias: 3,
  /** Regra 4: ">5h no mês" é do documento. */
  limiarHorasAvulso: 5,
  /** Regra 3: o exemplo do documento (20h, 10h, nada) são 2 quedas seguidas. */
  quedasSeguidas: 2,
  /** Métrica §1: o X do "cair X%". ⚠ Ainda não definido pelo cliente. */
  limiarQuedaPct: 30,
  /**
   * Regra 5: estreia anterior a esta data não conta.
   *
   * ⚠ Sem corte, todo cliente antigo parece estreante e sairiam milhares de
   * ofertas de uma vez. É o freio que o repositório marcou como obrigatório.
   */
  primeiraReservaDesde: "2026-08-01",
} as const;

const h = (v: { toFixed: (n: number) => string }) => `${Number(v.toFixed(1))}h`.replace(".", ",");

export async function sinaisDoCliente(customerConexaId: number): Promise<Sinal[]> {
  const hoje = keyToUtcDate(todayKey());
  const mesAtual = currentMonthKey();

  const [contratos, horas, bookings, mensais, vendas] = await Promise.all([
    prisma.contract.findMany({
      where: {
        customerConexaId,
        isActive: true,
        OR: [{ endDate: null }, { endDate: { gte: hoje } }],
      },
      orderBy: { startDate: "asc" },
    }),
    horasDoCliente(customerConexaId),
    prisma.roomBooking.findMany({
      where: { customerConexaId, isActive: true, cancellationReason: null },
      select: { dataLocal: true, horas: true },
      orderBy: { dataLocal: "asc" },
    }),
    prisma.customerMonthlyRevenue.findMany({
      where: { customerConexaId },
      select: { mesKey: true, receita: true },
      orderBy: { mesKey: "asc" },
    }),
    prisma.sale.findMany({ where: { customerConexaId }, select: { productConexaId: true } }),
  ]);

  const planoIds = [...new Set(contratos.map((c) => c.planConexaId).filter((x): x is number => x !== null))];
  const planos = planoIds.length
    ? await prisma.plan.findMany({ where: { conexaId: { in: planoIds } } })
    : [];
  const catIds = [...new Set(planos.map((p) => p.serviceCategoryConexaId).filter((x): x is number => x !== null))];
  const categorias = catIds.length
    ? await prisma.serviceCategory.findMany({ where: { conexaId: { in: catIds } } })
    : [];
  const nomeCat = new Map(categorias.map((c) => [c.conexaId, c.name ?? ""]));
  const planoPor = new Map(planos.map((p) => [p.conexaId, p]));

  /** Categoria de serviço do contrato — a fonte legítima de segmento. */
  const categoriaDo = (planConexaId: number | null) => {
    const p = planConexaId !== null ? planoPor.get(planConexaId) : undefined;
    return p?.serviceCategoryConexaId != null ? nomeCat.get(p.serviceCategoryConexaId) ?? "" : "";
  };

  const compradas = [...new Set(vendas.map((v) => v.productConexaId).filter((x): x is number => x !== null))];
  const sinais: Sinal[] = [];

  // ── extra · EXCEDENTE — o único que já dispara hoje ─────────────────────
  sinais.push(
    horas.semContrato
      ? sem("extra", "Estoura a cota de horas", "EXCEDENTE", "upgrade de plano",
          "Cliente sem contrato ativo com plano — não há cota a estourar.")
      : horas.atribuicaoAmbigua
        ? ambiguo("extra", "Estoura a cota de horas", "EXCEDENTE", "upgrade de plano",
            "Mais de um contrato com cota: a reserva não diz de qual balde a hora saiu.")
        : horas.sinal?.recorrente
          ? ativo("extra", "Estoura a cota de horas", "EXCEDENTE", "upgrade de plano",
              `Estourou em ${horas.sinal.ciclosComEstouro} de ${horas.sinal.ciclosConclusivos} ciclos conclusivos.`,
              `${h(horas.sinal.horasExcedentes)} pagas por fora do plano`)
          : sem("extra", "Estoura a cota de horas", "EXCEDENTE", "upgrade de plano",
              horas.sinal
                ? `Estourou em ${horas.sinal.ciclosComEstouro} de ${horas.sinal.ciclosConclusivos} ciclos — não é recorrente.`
                : "Sem ciclos fechados suficientes para avaliar."),
  );

  // ── MARCO_CONTRATO · regras 1, 6, 7, 8 ──────────────────────────────────
  const marcos: Array<{ regra: string; nome: string; meses: number; oferta: string; privativa: boolean }> = [
    { regra: "1", nome: "Fiscal completa 11 meses", meses: 11, oferta: "plano Bianual", privativa: false },
    { regra: "6", nome: "Privativa completa 1 mês", meses: 1, oferta: "Registro de Marca", privativa: true },
    { regra: "7", nome: "Privativa completa 2 meses", meses: 2, oferta: "SeaBox como benefício", privativa: true },
    { regra: "8", nome: "Privativa completa 6 meses", meses: 6, oferta: "Panteão", privativa: true },
  ];

  for (const m of marcos) {
    const candidatos = contratos.filter((c) => {
      const cat = categoriaDo(c.planConexaId);
      return m.privativa ? ehSegmentoPrivativa(cat) : ehSegmentoFiscal(cat);
    });

    if (!candidatos.length) {
      sinais.push(sem(m.regra, m.nome, "MARCO_CONTRATO", m.oferta,
        `Nenhum contrato ativo de ${m.privativa ? "sala privativa" : "Endereço Fiscal"}.`));
      continue;
    }
    const semData = candidatos.filter((c) => !c.startDate);
    const atingiu = candidatos.find(
      (c) => c.startDate && marcoAtingido({
        inicio: c.startDate, meses: m.meses, hoje, toleranciaDias: PARAMS.toleranciaMarcoDias,
      }),
    );

    if (atingiu) {
      sinais.push(ativo(m.regra, m.nome, "MARCO_CONTRATO", m.oferta,
        `Contrato #${atingiu.conexaId} completou ${m.meses} ${m.meses === 1 ? "mês" : "meses"} (âncora startDate).`,
        `desde ${fmtDia(atingiu.startDate!)}`));
    } else if (semData.length === candidatos.length) {
      sinais.push(indisponivel(m.regra, m.nome, "MARCO_CONTRATO", m.oferta,
        "Contrato sem `startDate` — não há de onde contar o marco."));
    } else {
      sinais.push(sem(m.regra, m.nome, "MARCO_CONTRATO", m.oferta,
        `Nenhum contrato no marco de ${m.meses} ${m.meses === 1 ? "mês" : "meses"} hoje.`));
    }
  }

  // ── USO_SEM_COTA · regra 4 ──────────────────────────────────────────────
  const horasNoMes = bookings
    .filter((b) => b.dataLocal && b.dataLocal.toISOString().slice(0, 7) === mesAtual)
    .reduce((acc, b) => acc.plus(money(b.horas?.toString() ?? 0)), money(0));
  const temCota = horas.contratos.some((c) => c.concedido !== null);

  sinais.push(
    usoAvulsoAlto({ temContratoComCota: temCota, horasNoMes, limiarHoras: PARAMS.limiarHorasAvulso })
      ? ativo("4", "Avulso com uso alto", "USO_SEM_COTA", "pacote de horas",
          `Sem contrato com cota e ${h(horasNoMes)} usadas em ${mesAtual}. ⚠ A economia vs. avulso não sai: a API não expõe preço por hora.`,
          `${h(horasNoMes)} no mês`)
      : sem("4", "Avulso com uso alto", "USO_SEM_COTA", "pacote de horas",
          temCota
            ? "Tem contrato com cota — este gatilho é para quem só compra avulso."
            : `${h(horasNoMes)} no mês, abaixo do limiar de ${PARAMS.limiarHorasAvulso}h.`),
  );

  // ── PRIMEIRO_EVENTO · regra 5 ───────────────────────────────────────────
  const primeira = bookings.find((b) => b.dataLocal)?.dataLocal ?? null;
  const estreou = primeiraReserva({
    primeiraReservaEm: primeira,
    hoje,
    dataDeCorte: keyToUtcDate(PARAMS.primeiraReservaDesde),
    toleranciaDias: PARAMS.toleranciaMarcoDias,
  });
  // A oferta inclui SeaBox, e SeaBox pode vir de cortesia num plano — sem o
  // mapeamento, "já tem?" não tem resposta. É `AMBIGUO`, não `ATIVO`.
  const posseSeabox = posseDoProduto({ produtoAlvo: -1, comprados: compradas, cortesiasDoPlano: null });
  sinais.push(
    !estreou
      ? sem("5", "Primeira reserva de sala", "PRIMEIRO_EVENTO", "Endereço Fiscal + SeaBox",
          primeira
            ? `Primeira reserva em ${fmtDia(primeira)} — fora da janela de estreia.`
            : "Cliente nunca reservou sala.")
      : posseSeabox === "DESCONHECIDO"
        ? ambiguo("5", "Primeira reserva de sala", "PRIMEIRO_EVENTO", "Endereço Fiscal + SeaBox",
            `Estreou em ${fmtDia(primeira!)}, mas não dá para saber se o plano dele já embute SeaBox de cortesia — o mapeamento não existe.`,
            `estreia em ${fmtDia(primeira!)}`)
        : ativo("5", "Primeira reserva de sala", "PRIMEIRO_EVENTO", "Endereço Fiscal + SeaBox",
            `Primeira reserva em ${fmtDia(primeira!)}.`, `estreia em ${fmtDia(primeira!)}`),
  );

  // ── EVENTO_EM_SEGMENTO · regra 10 ───────────────────────────────────────
  const litoral = contratos.some((c) => {
    if (!ehSegmentoFiscal(categoriaDo(c.planConexaId))) return false;
    const p = c.planConexaId !== null ? planoPor.get(c.planConexaId) : undefined;
    return p?.horasInclusasMes == null; // sem cota = Litoral (Fase 0)
  });
  const reservasNoMes = bookings.filter(
    (b) => b.dataLocal && b.dataLocal.toISOString().slice(0, 7) === mesAtual,
  ).length;

  sinais.push(
    litoralReservouSala({ temPlanoFiscalSemCota: litoral, reservasNoPeriodo: reservasNoMes })
      ? ativo("10", "Litoral reserva sala", "EVENTO_EM_SEGMENTO", "Pacote de Horas ou upgrade para Batial",
          `Endereço Fiscal sem horas inclusas, com ${reservasNoMes} reserva(s) em ${mesAtual}.`,
          `${reservasNoMes} reserva(s)`)
      : sem("10", "Litoral reserva sala", "EVENTO_EM_SEGMENTO", "Pacote de Horas ou upgrade para Batial",
          litoral ? `Nenhuma reserva em ${mesAtual}.` : "Não tem plano de Endereço Fiscal sem cota."),
  );

  // ── TENDENCIA · regra 3 e a métrica do §1 ───────────────────────────────
  const fechados = new Set(ultimosMesesFechados(12));
  const serie = mensais
    .filter((m) => fechados.has(m.mesKey))
    .map((m) => ({ mesKey: m.mesKey, valor: money(m.receita.toString()) }));

  const queda = quedaMesAMes({ serie, quedasSeguidas: PARAMS.quedasSeguidas });
  sinais.push(
    queda.disparou
      ? ambiguo("3", "Padrão de compra irregular", "TENDENCIA", "novo pacote",
          `Receita caiu em ${queda.quedas} meses seguidos (${queda.de} → ${queda.ate}). ⚠ Avaliado sobre RECEITA: falta o cliente definir se "comprou 20h" é compra ou consumo — vêm de endpoints diferentes.`,
          `${queda.quedas} quedas seguidas`)
      : sem("3", "Padrão de compra irregular", "TENDENCIA", "novo pacote",
          serie.length < PARAMS.quedasSeguidas + 1
            ? "Série curta demais para avaliar tendência."
            : `Sem ${PARAMS.quedasSeguidas} quedas seguidas nos meses fechados.`),
  );

  const ult = serie.at(-1);
  const pen = serie.at(-2);
  const pct = ult && pen ? quedaPercentual({ atual: ult.valor, anterior: pen.valor, limiarPct: PARAMS.limiarQuedaPct }) : null;
  sinais.push(
    !pct
      ? indisponivel("métrica", "Queda de receita", "TENDENCIA", "olhar antes que o cliente saia",
          "Sem dois meses fechados para comparar.")
      : pct.variacaoPct === null
        ? sem("métrica", "Queda de receita", "TENDENCIA", "olhar antes que o cliente saia",
            "Mês anterior sem receita — não existe base de comparação. Não é queda de 100%.")
        : pct.disparou
          ? ativo("métrica", "Queda de receita", "TENDENCIA", "olhar antes que o cliente saia",
              `Caiu ${Math.abs(pct.variacaoPct).toFixed(1)}% de ${pen!.mesKey} para ${ult!.mesKey}. ⚠ Limiar de ${PARAMS.limiarQuedaPct}% é exemplo, não decisão do cliente.`,
              `${pct.variacaoPct.toFixed(1)}%`)
          : sem("métrica", "Queda de receita", "TENDENCIA", "olhar antes que o cliente saia",
              `Variação de ${pct.variacaoPct.toFixed(1)}%, dentro do limiar de ${PARAMS.limiarQuedaPct}%.`),
  );

  // ── SALDO_COTA · regras 2 e 9 ───────────────────────────────────────────
  // O documento (§3.1) diz que a API não expõe o saldo. Ele é derivado, e
  // derivado não conferido NÃO vira sinal — é a regra de ouro do projeto.
  for (const [regra, nome] of [["2", "Pacote de horas acabando"], ["9", "Pacote abaixo de 5h"]] as const) {
    sinais.push(indisponivel(regra, nome, "SALDO_COTA", "novo pacote",
      "O saldo é derivado e ainda não foi conferido contra a tela do Conexa. Nenhum disparo acontece sobre ele — ver Confiança."));
  }

  const ordem = ["extra", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "métrica"];
  return sinais.sort((a, b) => ordem.indexOf(a.regra) - ordem.indexOf(b.regra));
}

// ── construtores, só para a lista acima ficar legível ─────────────────────
const mk = (estado: EstadoSinal) =>
  (regra: string, nome: string, familia: string, oferta: string, motivo: string, evidencia?: string): Sinal =>
    ({ regra, nome, familia, oferta, estado, motivo, evidencia });

const ativo = mk("ATIVO");
const sem = mk("NAO_APLICAVEL");
const indisponivel = mk("DADO_INDISPONIVEL");
const ambiguo = mk("AMBIGUO");

function fmtDia(d: Date): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(d);
}
