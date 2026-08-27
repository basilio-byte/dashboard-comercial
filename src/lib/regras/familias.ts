import { addMesesClamp } from "@/lib/metrics/horas";
import type { Money } from "@/lib/money";

/**
 * AS FAMÍLIAS DE REGRA — funções PURAS.
 *
 * O documento do Diego (§2, "Camada de regras") pede exatamente isto: *"cada
 * regra da tabela acima vira uma função de verificação simples que roda sobre o
 * dataset consolidado. São checagens determinísticas de data/threshold, não
 * precisam de modelo de IA para decidir."*
 *
 * As 10 regras colapsam em 6 famílias (ADR-0007). Manter 10 arquivos seria ter
 * 10 lugares para corrigir o mesmo bug de aritmética de datas.
 *
 * ⚠ Sem Prisma, sem rede, sem `Date.now()`. Tudo entra por parâmetro — inclusive
 * "hoje" —, porque regra que lê o relógio sozinha não é testável, e uma regra
 * não testável dispara oferta errada para cliente real.
 *
 * ⚠ Todo limiar é PARÂMETRO, nunca constante. O documento diz "cair X% de um
 * mês para outro": o X é do cliente, não do desenvolvedor. Ver a memória sobre
 * configuração morar na UI.
 */

// ---------------------------------------------------------------------------
// MARCO_CONTRATO — regras 1, 6, 7 e 8
// ---------------------------------------------------------------------------

/**
 * O contrato completou N meses?
 *
 * ⚠ **Âncora decidida pelo dono em 2026-08-27: `startDate`.** A pergunta estava
 * aberta desde a Fase 0 porque `startDate` e `fidelityDate` **divergem nos
 * dados reais** — e a escolha muda quem entra na fila. Quem chama passa a data
 * já escolhida; esta função não decide âncora.
 *
 * ⚠ **Regra 8 é ANIVERSÁRIO, não janela aberta** — também decidido em
 * 2026-08-27. "Até o 6º mês" dispara NO marco dos 6 meses, com a tolerância
 * abaixo, e não todo dia do 1º ao 6º mês. A diferença é entre uma oferta e
 * cento e oitenta.
 *
 * A tolerância existe porque o job roda uma vez por dia: sem ela, um marco que
 * caia num dia de falha da carga é perdido para sempre.
 */
export function marcoAtingido(p: {
  inicio: Date;
  meses: number;
  hoje: Date;
  toleranciaDias: number;
}): boolean {
  const aniversario = addMesesClamp(p.inicio, p.meses);
  const limite = new Date(aniversario);
  limite.setUTCDate(limite.getUTCDate() + p.toleranciaDias);
  return p.hoje >= aniversario && p.hoje <= limite;
}

// ---------------------------------------------------------------------------
// TENDENCIA — regras 3 e 11
// ---------------------------------------------------------------------------

export interface PontoMensal {
  /** 'yyyy-MM'. */
  mesKey: string;
  valor: Money;
}

/**
 * Regra 3 — padrão de compra irregular.
 *
 * ⚠ **Definido pelo dono em 2026-08-27: "mês a mês".** Leio como *queda em
 * meses CONSECUTIVOS*, que é o que o exemplo do próprio documento mostra —
 * "comprou 20h em jun, 10h em jul, nada em ago": três meses, duas quedas
 * seguidas. Por isso `quedasSeguidas` tem default 2 e é parâmetro: se o
 * significado pretendido for outro número, muda num lugar só.
 *
 * ⚠ Só meses FECHADOS. O mês em curso está pela metade e faria a base inteira
 * parecer em queda todo dia 1º.
 *
 * ⚠ Zero no meio da série **conta como queda** (é o "nada em ago" do exemplo),
 * mas uma série que começa em zero não é queda: é ausência de base.
 */
export function quedaMesAMes(p: {
  serie: PontoMensal[];
  quedasSeguidas?: number;
}): { disparou: boolean; quedas: number; de: string | null; ate: string | null } {
  const exigidas = p.quedasSeguidas ?? 2;
  const serie = [...p.serie].sort((a, b) => a.mesKey.localeCompare(b.mesKey));
  const nulo = { disparou: false, quedas: 0, de: null, ate: null };
  if (serie.length < exigidas + 1) return nulo;

  // Conta as quedas consecutivas terminando no mês mais recente: o padrão que
  // interessa é o que está acontecendo AGORA, não um vale de dois anos atrás.
  let quedas = 0;
  for (let i = serie.length - 1; i > 0; i--) {
    const atual = serie[i]!;
    const anterior = serie[i - 1]!;
    if (anterior.valor.lessThanOrEqualTo(0)) break; // sem base de comparação
    if (atual.valor.greaterThanOrEqualTo(anterior.valor)) break;
    quedas++;
  }

  if (quedas < exigidas) return { disparou: false, quedas, de: null, ate: null };
  return {
    disparou: true,
    quedas,
    de: serie[serie.length - 1 - quedas]!.mesKey,
    ate: serie[serie.length - 1]!.mesKey,
  };
}

/**
 * Regra 11 (bônus) — a métrica "alerta se cair X% de um mês para outro", do
 * documento do Diego (§1, Métricas).
 *
 * ⚠ `anterior <= 0` NÃO é queda de 100%: é ausência de base. Confundir os dois
 * marcaria como despencando todo cliente que faturou pela primeira vez.
 */
export function quedaPercentual(p: {
  atual: Money;
  anterior: Money;
  limiarPct: number;
}): { disparou: boolean; variacaoPct: number | null } {
  if (p.anterior.lessThanOrEqualTo(0)) return { disparou: false, variacaoPct: null };
  const variacao = Number(p.atual.minus(p.anterior).div(p.anterior).times(100));
  return { disparou: variacao <= -Math.abs(p.limiarPct), variacaoPct: variacao };
}

// ---------------------------------------------------------------------------
// USO_SEM_COTA — regra 4
// ---------------------------------------------------------------------------

/**
 * Regra 4 — avulso com uso alto.
 *
 * "Cliente só compra hora avulsa, mas usou >5h no mês."
 *
 * ⚠ "Só compra avulsa" = **nenhum contrato ativo com cota**. Não é o mesmo que
 * "não tem contrato": o Endereço Fiscal Litoral tem contrato e não tem cota, e
 * é justamente ele quem paga tudo por fora.
 *
 * ⚠ A oferta pede "mostrar economia vs. avulso", e o próprio documento do Diego
 * registra em §3.1 que a API **não expõe preço por hora a nível de produto**.
 * A regra dispara mesmo assim; quem monta a task declara a economia como lacuna
 * em vez de estimar. Nunca com número inventado.
 */
export function usoAvulsoAlto(p: {
  temContratoComCota: boolean;
  horasNoMes: Money;
  limiarHoras?: number;
}): boolean {
  if (p.temContratoComCota) return false;
  return p.horasNoMes.greaterThan(p.limiarHoras ?? 5);
}

// ---------------------------------------------------------------------------
// PRIMEIRO_EVENTO — regra 5
// ---------------------------------------------------------------------------

/**
 * Regra 5 — primeira reserva de sala.
 *
 * ⚠ **Risco de disparo em massa.** Sem histórico completo de reservas, todo
 * cliente antigo parece estreante e a regra criaria milhares de tasks de uma
 * vez. Por isso `dataDeCorte` é obrigatório: só conta como estreia o que
 * acontece DEPOIS do corte, e o corte só faz sentido com o selo de completude
 * das reservas — que fechou em 2026-08-27 (37/37 janelas).
 */
export function primeiraReserva(p: {
  primeiraReservaEm: Date | null;
  hoje: Date;
  dataDeCorte: Date;
  toleranciaDias: number;
}): boolean {
  if (!p.primeiraReservaEm) return false;
  if (p.primeiraReservaEm < p.dataDeCorte) return false; // estreia antiga: não é evento
  const limite = new Date(p.primeiraReservaEm);
  limite.setUTCDate(limite.getUTCDate() + p.toleranciaDias);
  return p.hoje >= p.primeiraReservaEm && p.hoje <= limite;
}

// ---------------------------------------------------------------------------
// EVENTO_EM_SEGMENTO — regra 10
// ---------------------------------------------------------------------------

/**
 * Regra 10 — Endereço Litoral que reserva sala.
 *
 * ⚠ O tier vem da **cota do plano**, não do nome do produto. Medido na Fase 0:
 * Litoral = `hourQuotas` nulo · Batial = 2h · Abissal = 8h. Classificar por
 * substring do nome seria inventar dado, e o catálogo tem grafias divergentes
 * ("Endereço Fiscal de Comércio" vs "De Comercio").
 *
 * Por isso a entrada é `temPlanoFiscalSemCota` — um fato estrutural — e não o
 * nome do plano.
 */
export function litoralReservouSala(p: {
  temPlanoFiscalSemCota: boolean;
  reservasNoPeriodo: number;
}): boolean {
  return p.temPlanoFiscalSemCota && p.reservasNoPeriodo > 0;
}
