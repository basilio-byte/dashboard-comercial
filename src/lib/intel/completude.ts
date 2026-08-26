import "server-only";
import { prisma } from "@/lib/db";

/**
 * SELO DE COMPLETUDE (ADR-0011).
 *
 * O problema que isto resolve foi observado ao rodar a primeira carga de
 * verdade: o backfill parou no teto de páginas com só os clientes carregados,
 * a consolidação rodou assim mesmo, e o resultado foram 5.000 perfis com
 * receita R$ 0,00 — **indistinguíveis de clientes que realmente não faturaram**.
 *
 * Zero e "ainda não carreguei" são coisas diferentes, e confundi-las é
 * exatamente o que a regra de ouro do projeto proíbe. Pior: sobre esses zeros,
 * a regra de tendência veria a base inteira despencando, e a de saldo veria
 * cota cheia para todo mundo.
 *
 * Então: nada de derivado é apresentado como fato sem que a fonte esteja
 * completa. Quando não está, o número vira LACUNA declarada.
 */

/** Entidades cuja completude importa para algum número exibido. */
export const ENTIDADES = ["customers", "contracts", "charges", "sales"] as const;
export type Entidade = (typeof ENTIDADES)[number];

export interface EstadoEntidade {
  entidade: Entidade;
  /** Backfill terminou (sem cursor pendente) E houve ao menos uma carga. */
  completa: boolean;
  /** Onde o cursor parou, quando incompleta. */
  cursor: number | null;
  registros: number;
}

export interface EstadoEspelho {
  entidades: EstadoEntidade[];
  /** Dá para apresentar receita como fato? Exige clientes E cobranças completos. */
  receitaConfiavel: boolean;
  incompletas: Entidade[];
}

const CONTADOR: Record<Entidade, () => Promise<number>> = {
  customers: () => prisma.customer.count(),
  contracts: () => prisma.contract.count(),
  charges: () => prisma.charge.count(),
  sales: () => prisma.sale.count(),
};

export async function estadoDoEspelho(): Promise<EstadoEspelho> {
  const estados = await prisma.syncState.findMany({
    where: { key: { in: ENTIDADES.map((e) => `${e}:offset`) } },
  });
  const cursorPor = new Map(estados.map((e) => [e.key.replace(":offset", ""), Number(e.cursor ?? 0)]));

  const entidades: EstadoEntidade[] = [];
  for (const entidade of ENTIDADES) {
    const registros = await CONTADOR[entidade]();
    const cursor = cursorPor.has(entidade) ? cursorPor.get(entidade)! : null;
    entidades.push({
      entidade,
      // Cursor presente = backfill parou no meio. Cursor ausente + zero registro
      // = nunca rodou. Completa exige as duas coisas.
      completa: cursor === null && registros > 0,
      cursor,
      registros,
    });
  }

  const incompletas = entidades.filter((e) => !e.completa).map((e) => e.entidade);
  const completa = (e: Entidade) => entidades.find((x) => x.entidade === e)!.completa;

  return {
    entidades,
    receitaConfiavel: completa("customers") && completa("charges"),
    incompletas,
  };
}

/** Rótulo pt-BR para a tela. */
export const ROTULO_ENTIDADE: Record<Entidade, string> = {
  customers: "clientes",
  contracts: "contratos",
  charges: "cobranças",
  sales: "vendas",
};
