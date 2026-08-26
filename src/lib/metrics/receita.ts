import { money, sum, roundMoney, variacaoPercentual, type Money, ZERO } from "@/lib/money";

/**
 * A RÉGUA DA RECEITA — copiada literalmente do Dashboard Financeiro (ADR-0006).
 *
 * O critério de aceite da Fase 1 é que a receita de um mês fechado bata **ao
 * centavo** com a do financeiro. Duas implementações da mesma definição são duas
 * chances de divergir, e um número comercial que contradiz o financeiro destrói
 * a confiança nos dois. Então: mesma régua, sem melhorias criativas.
 *
 * Funções PURAS, sem Prisma e sem rede — para poderem ser testadas com fixtures.
 */

/** Status que significam cobrança cancelada. */
const STATUS_CANCELADOS = new Set(["cancelled", "canceled", "billedCancelled"]);

/** O mínimo que uma cobrança precisa ter para entrar numa soma de receita. */
export interface CobrancaParaReceita {
  status?: string | null;
  cancelDate?: Date | string | null;
  amount: number | string;
  currentAmount?: number | string | null;
  paidAmount?: number | string | null;
}

export function estaCancelada(c: CobrancaParaReceita): boolean {
  if (c.cancelDate) return true;
  return c.status ? STATUS_CANCELADOS.has(c.status) : false;
}

/**
 * Cobrança que CONTA como receita — nem cancelada, nem negociada.
 *
 * `negotiated` é a cobrança ORIGINAL que uma renegociação substituiu; o Conexa
 * cria uma cobrança NOVA que já entra nos totais. Somar as duas é dupla
 * contagem — o irmão mediu ~R$ 132 mil de receita-fantasma num ano por causa
 * disso.
 */
export function contaComoReceita(c: CobrancaParaReceita): boolean {
  return !estaCancelada(c) && c.status !== "negotiated";
}

/**
 * Valor faturado de uma cobrança.
 *
 * ⚠ `currentAmount` (COM juros e multa), com `amount` como fallback quando a API
 * não o traz. É o que a tela do Conexa soma — validado pelo irmão em junho/2026:
 * 1.182/1.182 cobranças, R$ 444.143,59 = R$ 444.143,59, diferença R$ 0,00.
 * Usar `amount` daria R$ 3.317,95 a menos em 481 cobranças.
 */
export function valorFaturado(c: CobrancaParaReceita): Money {
  if (c.currentAmount !== null && c.currentAmount !== undefined) return money(c.currentAmount);
  return money(c.amount);
}

/** Soma a receita de um conjunto de cobranças, aplicando a régua. */
export function somarReceita(cobrancas: CobrancaParaReceita[]): { total: Money; contagem: number } {
  const reconhecidas = cobrancas.filter(contaComoReceita);
  return {
    total: roundMoney(sum(reconhecidas.map(valorFaturado))),
    contagem: reconhecidas.length,
  };
}

// ---------------------------------------------------------------------------
// Série mensal e variação
// ---------------------------------------------------------------------------

export interface PontoMensal {
  mesKey: string;
  receita: Money;
  cobrancas: number;
  /** `null` quando não há mês anterior na série ou quando ele é zero. */
  variacaoPct: number | null;
}

/**
 * Monta a série mensal a partir de cobranças já agrupadas por mês.
 *
 * `mesesEsperados` entra explicitamente para que um mês SEM cobrança apareça
 * como zero, e não desapareça da série — um buraco silencioso faria a variação
 * comparar meses não adjacentes.
 */
export function serieMensal(
  porMes: Map<string, CobrancaParaReceita[]>,
  mesesEsperados: string[],
): PontoMensal[] {
  const pontos: PontoMensal[] = [];
  let anterior: Money | null = null;

  for (const mesKey of mesesEsperados) {
    const { total, contagem } = somarReceita(porMes.get(mesKey) ?? []);
    pontos.push({
      mesKey,
      receita: total,
      cobrancas: contagem,
      variacaoPct: anterior === null ? null : variacaoPercentual(total, anterior),
    });
    anterior = total;
  }
  return pontos;
}

/**
 * Clientes em queda: variação abaixo de `-limiarPct` no último mês da série.
 *
 * ⚠ Só considera pontos com `variacaoPct !== null`. Cliente cujo mês anterior
 * foi zero **não está em queda** — está estreando ou voltando. Marcar esse caso
 * como queda de 100% encheria a fila de falso positivo, que é o risco de produto
 * número um do projeto.
 */
export function estaEmQueda(ponto: PontoMensal, limiarPct: number): boolean {
  if (ponto.variacaoPct === null) return false;
  return ponto.variacaoPct <= -Math.abs(limiarPct);
}

// ---------------------------------------------------------------------------
// Top clientes
// ---------------------------------------------------------------------------

export interface ClienteComReceita {
  customerConexaId: number;
  nome: string | null;
  receita: Money;
}

/**
 * Top N por receita, decrescente.
 *
 * Desempate pelo `customerConexaId` para a ordem ser **determinística**: sem
 * isso, dois clientes com o mesmo valor trocam de posição entre execuções e o
 * "Top 5" muda sozinho na tela, sem nada ter mudado no negócio.
 */
export function topClientes(clientes: ClienteComReceita[], n = 5): ClienteComReceita[] {
  return [...clientes]
    .filter((c) => !c.receita.isZero())
    .sort((a, b) => {
      const cmp = b.receita.comparedTo(a.receita);
      return cmp !== 0 ? cmp : a.customerConexaId - b.customerConexaId;
    })
    .slice(0, n);
}

/** Participação de cada cliente no total, em % (para a barra da tela). */
export function participacao(receita: Money, total: Money): number | null {
  if (total.isZero()) return null;
  return Number(receita.div(total).times(100).toDecimalPlaces(2));
}

export const RECEITA_ZERO: Money = ZERO;
