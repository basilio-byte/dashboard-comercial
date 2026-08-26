import Decimal from "decimal.js";

/**
 * Aritmética monetária com rigor. NUNCA usar `number` para somar ou multiplicar
 * dinheiro — sempre passar por aqui. `0.1 + 0.2 !== 0.3`.
 *
 * Copiado do projeto irmão (Dashboard Financeiro) de propósito: a receita do
 * comercial precisa bater **ao centavo** com a dele (ADR-0006), e duas
 * implementações de arredondamento são duas chances de divergir.
 *
 * Clone isolado do Decimal para não mexer em configuração global.
 */
const M = Decimal.clone({ precision: 30, rounding: Decimal.ROUND_HALF_UP });

export type Money = Decimal;

/** Valor monetário a partir de number | string | Decimal | null | undefined. */
export function money(value: number | string | Decimal | null | undefined): Money {
  if (value === null || value === undefined || value === "") return new M(0);
  return new M(typeof value === "number" ? String(value) : value);
}

export const ZERO: Money = new M(0);

/** Soma segura de uma lista (ignora null/undefined). */
export function sum(values: Array<number | string | Decimal | null | undefined>): Money {
  return values.reduce<Money>((acc, v) => acc.plus(money(v)), new M(0));
}

export function add(a: Money, b: Money): Money {
  return a.plus(b);
}

export function subtract(a: Money, b: Money): Money {
  return a.minus(b);
}

/** Arredonda para centavos, modo comercial. */
export function roundMoney(value: Money): Money {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export function isZero(value: Money): boolean {
  return value.isZero();
}

/** String canônica com 2 casas — o formato de transporte e de persistência. */
export function toAmountString(value: Money): string {
  return roundMoney(value).toFixed(2);
}

/** Formatação pt-BR para tela. */
export function formatBRL(value: Money | string | number): string {
  const d = money(value as never);
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(roundMoney(d).toFixed(2)));
}

/**
 * Variação percentual de `anterior` para `atual`.
 *
 * ⚠ Devolve **null** quando o anterior é zero — e isso é regra de negócio, não
 * detalhe técnico. Sem base não existe "queda de X%": dividir por zero daria
 * Infinity, e tratar como 100% marcaria em queda todo cliente que simplesmente
 * não comprou no mês anterior. É critério de aceite da Fase 1.
 */
export function variacaoPercentual(atual: Money, anterior: Money): number | null {
  if (anterior.isZero()) return null;
  return Number(atual.minus(anterior).div(anterior).times(100).toDecimalPlaces(4));
}
