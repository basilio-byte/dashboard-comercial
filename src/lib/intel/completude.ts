import "server-only";
import { prisma } from "@/lib/db";
import { janelasDoPeriodo } from "@/lib/conexa/sync-janelas";

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
export const ENTIDADES = ["customers", "contracts", "charges", "sales", "bookings"] as const;
export type Entidade = (typeof ENTIDADES)[number];

export interface EstadoEntidade {
  entidade: Entidade;
  /** Todas as janelas do período estão CONCLUIDA. */
  completa: boolean;
  /** Janelas mensais previstas para o histórico da entidade. */
  janelasTotais: number;
  janelasConcluidas: number;
  registros: number;
}

export interface EstadoEspelho {
  entidades: EstadoEntidade[];
  /** Dá para apresentar receita como fato? Exige clientes E cobranças completos. */
  receitaConfiavel: boolean;
  /** Dá para apresentar consumo de horas? Exige contratos E reservas completos. */
  horasConfiavel: boolean;
  /** Toda entidade incompleta, para o aviso geral de completude. */
  incompletas: Entidade[];
  /**
   * ⚠ QUAIS entidades barram CADA portão — não a lista geral.
   *
   * As mensagens de bloqueio interpolavam `incompletas` inteira, então a fila de
   * excedente dizia "Espelho incompleto (customers, charges, sales, bookings)"
   * quando só `bookings` a barrava. Três entidades inocentes acusadas, e quem
   * lesse iria empurrar carga de `sales` — que não destrava portão nenhum — para
   * resolver um bloqueio de reservas.
   *
   * Culpa errada num aviso de bloqueio é pior que aviso genérico: manda a pessoa
   * trabalhar no lugar errado com confiança.
   */
  barramHoras: Entidade[];
  barramReceita: Entidade[];
}

const CONTADOR: Record<Entidade, () => Promise<number>> = {
  customers: () => prisma.customer.count(),
  contracts: () => prisma.contract.count(),
  charges: () => prisma.charge.count(),
  sales: () => prisma.sale.count(),
  bookings: () => prisma.roomBooking.count(),
};

/**
 * ⚠ Completude agora é "todas as janelas mensais estão CONCLUIDA".
 *
 * A versão anterior perguntava "o cursor de offset sumiu?" — e o cursor some ao
 * fim da varredura mesmo que ela tenha PULADO registros (uma deleção no ERP
 * desloca a paginação e o registro na posição do cursor nunca é lido). Ou seja:
 * o selo antigo certificava o fim da varredura, não a completude do dado.
 *
 * Com janelas, a afirmação é verificável e re-executável: dá para reprocessar
 * uma janela e conferir.
 */
export async function estadoDoEspelho(): Promise<EstadoEspelho> {
  const janelas = await prisma.syncWindow.findMany({
    select: { entidade: true, janela: true, status: true, registros: true },
  });
  const fundos = await prisma.syncState.findMany({
    where: { key: { startsWith: "fundo:" } },
  });
  const fundoPor = new Map(fundos.map((i) => [i.key.replace("fundo:", ""), i.cursor]));

  const entidades: EstadoEntidade[] = [];
  for (const entidade of ENTIDADES) {
    const registros = await CONTADOR[entidade]();
    const minhas = janelas.filter((j) => j.entidade === entidade);
    const fundo = fundoPor.get(entidade);
    // Sem o FUNDO do histórico encontrado, não se sabe quantas janelas existem —
    // e "desconhecido" nunca é "completo". A versão anterior derivava o total de
    // uma janela inicial descoberta lendo `offset: 0`, premissa que a medição
    // derrubou: a API não devolve os registros em ordem.
    const doPeriodo = janelasDoPeriodo(fundo ?? null);
    const totais = doPeriodo?.size ?? 0;

    /**
     * ⚠ Conta só as janelas DO PERÍODO.
     *
     * Contava todas as CONCLUIDA da entidade, e para entidade mutável isso
     * inclui a janela do mês SEGUINTE que o incremental cria. O resultado era
     * um selo que podia mentir: com uma janela histórica pendente e a futura
     * concluída, `concluidas >= totais` fechava e a entidade era declarada
     * completa — liberando receita e fila para virarem "fato" sobre dado
     * incompleto. É exatamente o que este arquivo inteiro existe para impedir.
     */
    const concluidas = minhas.filter(
      (j) => j.status === "CONCLUIDA" && (!doPeriodo || doPeriodo.has(j.janela)),
    ).length;

    entidades.push({
      entidade,
      completa: totais > 0 && concluidas >= totais && registros > 0,
      janelasTotais: totais,
      janelasConcluidas: concluidas,
      registros,
    });
  }

  const incompletas = entidades.filter((e) => !e.completa).map((e) => e.entidade);
  const completa = (e: Entidade) => entidades.find((x) => x.entidade === e)!.completa;

  const barram = (deps: Entidade[]) => deps.filter((e) => !completa(e));

  return {
    entidades,
    receitaConfiavel: completa("customers") && completa("charges"),
    horasConfiavel: completa("contracts") && completa("bookings"),
    incompletas,
    barramHoras: barram(["contracts", "bookings"]),
    barramReceita: barram(["customers", "charges"]),
  };
}

/** Rótulo pt-BR para a tela. */
export const ROTULO_ENTIDADE: Record<Entidade, string> = {
  customers: "clientes",
  contracts: "contratos",
  charges: "cobranças",
  sales: "vendas",
  bookings: "reservas de sala",
};
