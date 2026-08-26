import "server-only";
import { prisma } from "@/lib/db";
import { conexaFetch, paginatePages, requisicoesFeitas, type ConexaPage } from "./client";
import { currentMonthKey } from "@/lib/dates";
import {
  ENTIDADES,
  gerarJanelas,
  janelasIncrementais,
  limitesDaJanela,
  type Entidade,
} from "./janelas";
import {
  mapCharge,
  mapContract,
  mapCustomer,
  mapRoomBooking,
  mapSale,
} from "./mappers";

/**
 * Sincronização por JANELA TEMPORAL.
 *
 * Cada entidade é varrida um mês por vez, e o progresso de cada mês vive em
 * `SyncWindow`. Isso dá três coisas que o cursor de offset global não dava:
 *
 * 1. **Completude verificável.** "Todas as janelas do período estão CONCLUIDA"
 *    é uma afirmação checável e re-executável. "O cursor chegou ao fim" não é —
 *    ele chega ao fim mesmo tendo pulado registros.
 * 2. **Buraco contido.** Uma deleção no ERP durante a carga desloca a paginação
 *    só dentro daquele mês, e reprocessar um mês custa poucas requisições.
 * 3. **Incremental de graça.** Sincronizar "o que mudou" vira reprocessar as
 *    janelas recentes — sem código novo.
 */

type Mapeador = (item: never) => { conexaId: number } | null;

const MAPEADORES: Record<Entidade, Mapeador> = {
  customers: mapCustomer as Mapeador,
  contracts: mapContract as Mapeador,
  charges: mapCharge as Mapeador,
  sales: mapSale as Mapeador,
  bookings: mapRoomBooking as Mapeador,
};

function delegateDe(entidade: Entidade) {
  switch (entidade) {
    case "customers":
      return prisma.customer;
    case "contracts":
      return prisma.contract;
    case "charges":
      return prisma.charge;
    case "sales":
      return prisma.sale;
    case "bookings":
      return prisma.roomBooking;
  }
}

async function gravarLote(entidade: Entidade, linhas: Array<{ conexaId: number }>): Promise<number> {
  if (!linhas.length) return 0;
  const delegate = delegateDe(entidade) as {
    upsert: (a: unknown) => Promise<unknown>;
  };
  const ops = linhas.map((linha) => {
    const { conexaId, ...resto } = linha as Record<string, unknown> & { conexaId: number };
    return delegate.upsert({
      where: { conexaId },
      create: linha,
      update: { ...resto, syncedAt: new Date() },
    });
  });
  await prisma.$transaction(ops as never);
  return linhas.length;
}

// ---------------------------------------------------------------------------
// Descoberta do início do histórico
// ---------------------------------------------------------------------------

/** Campo da resposta que carrega a data pela qual a janela corta. */
const CAMPO_DATA: Record<Entidade, string> = {
  customers: "createdAt",
  sales: "createdAt",
  bookings: "createdAt",
  charges: "dueDate",
  contracts: "startDate",
};

/**
 * A janela mais antiga com dado, descoberta uma vez e memorizada.
 *
 * `offset: 0` devolve o registro mais antigo (a API ordena por id crescente,
 * observado em produção). Sem isto, gerar janelas desde uma data chutada
 * desperdiçaria uma requisição por mês vazio.
 */
async function janelaInicial(entidade: Entidade): Promise<string> {
  const chave = `janela-inicial:${entidade}`;
  const guardado = await prisma.syncState.findUnique({ where: { key: chave } });
  if (guardado?.cursor) return guardado.cursor;

  const def = ENTIDADES[entidade];
  const page = await conexaFetch<ConexaPage<Record<string, unknown>>>(def.recurso, {
    query: { limit: 1, offset: 0 },
  });
  const itens = Array.isArray(page) ? page : (page.data ?? []);
  const bruto = itens[0]?.[CAMPO_DATA[entidade]];
  // Sem dado ou sem a data: cai no mês corrente, o que gera uma janela só.
  const janela = typeof bruto === "string" ? bruto.slice(0, 7) : currentMonthKey();

  await prisma.syncState.upsert({
    where: { key: chave },
    create: { key: chave, cursor: janela },
    update: { cursor: janela },
  });
  return janela;
}

// ---------------------------------------------------------------------------
// Execução de uma janela
// ---------------------------------------------------------------------------

export interface ResultadoJanela {
  entidade: Entidade;
  janela: string;
  status: "CONCLUIDA" | "EM_ANDAMENTO" | "FALHOU";
  registros: number;
}

/**
 * Varre uma janela até o fim (ou até o teto de páginas), retomando do offset já
 * gravado. Idempotente: reprocessar uma janela só reescreve os mesmos registros.
 */
export async function sincronizarJanela(
  entidade: Entidade,
  janela: string,
  opts: { maxPaginas?: number; signal?: AbortSignal } = {},
): Promise<ResultadoJanela> {
  const def = ENTIDADES[entidade];
  const { de, ate } = limitesDaJanela(janela, def.formato);

  const registro = await prisma.syncWindow.upsert({
    where: { entidade_janela: { entidade, janela } },
    create: { entidade, janela, status: "EM_ANDAMENTO", iniciadaEm: new Date() },
    update: { status: "EM_ANDAMENTO", iniciadaEm: new Date(), erro: null },
  });

  let offset = registro.offset;
  let registros = registro.registros;
  let paginas = 0;

  try {
    for await (const pagina of paginatePages<never>(
      def.recurso,
      { [`${def.filtro}From`]: de, [`${def.filtro}To`]: ate },
      { offsetInicial: offset, signal: opts.signal },
    )) {
      const linhas = pagina.itens
        .map(MAPEADORES[entidade])
        .filter((x): x is { conexaId: number } => x !== null);
      registros += await gravarLote(entidade, linhas);
      offset = pagina.proximoOffset;

      // Progresso gravado DEPOIS da escrita: morrer entre as duas coisas
      // reprocessa a página, o que o upsert torna inofensivo. O contrário
      // pularia registros em silêncio.
      await prisma.syncWindow.update({
        where: { entidade_janela: { entidade, janela } },
        data: { offset, registros },
      });

      paginas++;
      if (opts.signal?.aborted || (opts.maxPaginas && paginas >= opts.maxPaginas)) {
        return { entidade, janela, status: "EM_ANDAMENTO", registros };
      }
    }

    await prisma.syncWindow.update({
      where: { entidade_janela: { entidade, janela } },
      // O offset zera: uma reexecução da janela varre do começo, que é o que
      // torna a janela re-verificável.
      data: { status: "CONCLUIDA", concluidaEm: new Date(), offset: 0, registros },
    });
    return { entidade, janela, status: "CONCLUIDA", registros };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await prisma.syncWindow.update({
      where: { entidade_janela: { entidade, janela } },
      data: { status: "FALHOU", erro: msg },
    });
    return { entidade, janela, status: "FALHOU", registros };
  }
}

// ---------------------------------------------------------------------------
// Carga completa e incremental
// ---------------------------------------------------------------------------

export interface ResultadoCarga {
  janelasConcluidas: number;
  janelasPendentes: number;
  registros: number;
  requisicoes: number;
  interrompida: boolean;
  detalhe: ResultadoJanela[];
}

/**
 * Carga histórica: percorre as janelas pendentes, **da mais recente para a mais
 * antiga**.
 *
 * A ordem importa. Dado recente é o que o time comercial usa — as regras olham
 * os últimos ciclos e os últimos meses fechados. Começar pelo passado remoto
 * deixaria o sistema inútil durante horas; começando pelo presente, ele fica
 * útil já na primeira janela e vai ganhando profundidade.
 */
export async function cargaHistorica(
  opts: {
    entidades?: Entidade[];
    maxJanelas?: number;
    maxPaginasPorJanela?: number;
    signal?: AbortSignal;
  } = {},
): Promise<ResultadoCarga> {
  const alvos = opts.entidades ?? (Object.keys(ENTIDADES) as Entidade[]);
  const teto = opts.maxJanelas ?? 12;
  const detalhe: ResultadoJanela[] = [];
  let registros = 0;
  let interrompida = false;

  for (const entidade of alvos) {
    const inicio = await janelaInicial(entidade);
    const todas = gerarJanelas(inicio, currentMonthKey()).reverse(); // recente primeiro

    const feitas = await prisma.syncWindow.findMany({
      where: { entidade, status: "CONCLUIDA" },
      select: { janela: true },
    });
    const concluidas = new Set(feitas.map((f) => f.janela));

    for (const janela of todas) {
      if (concluidas.has(janela)) continue;
      if (detalhe.length >= teto || opts.signal?.aborted) {
        interrompida = true;
        break;
      }
      const r = await sincronizarJanela(entidade, janela, {
        maxPaginas: opts.maxPaginasPorJanela,
        signal: opts.signal,
      });
      detalhe.push(r);
      registros += r.registros;
      if (r.status === "FALHOU") break; // não insistir na mesma entidade
    }
    if (interrompida) break;
  }

  const [concluidas, pendentes] = await Promise.all([
    prisma.syncWindow.count({ where: { status: "CONCLUIDA" } }),
    prisma.syncWindow.count({ where: { status: { not: "CONCLUIDA" } } }),
  ]);

  return {
    janelasConcluidas: concluidas,
    janelasPendentes: pendentes,
    registros,
    requisicoes: requisicoesFeitas(),
    interrompida,
    detalhe,
  };
}

/**
 * Sincronização INCREMENTAL: reprocessa as janelas recentes.
 *
 * É o modo que faltava — antes `POST /api/sync` sem parâmetro devolvia 400
 * porque o modo default não tinha implementação.
 *
 * Para entidade imutável (recortada por `createdAt`), só a janela corrente:
 * registro novo nasce nela. Para entidade mutável (cobrança por vencimento,
 * contrato por início), também as vizinhas — editar a data move o registro de
 * janela, e a de destino precisa ser revisitada.
 */
export async function sincronizarIncremental(
  opts: { entidades?: Entidade[]; mesesParaTras?: number; signal?: AbortSignal } = {},
): Promise<ResultadoCarga> {
  const alvos = opts.entidades ?? (Object.keys(ENTIDADES) as Entidade[]);
  const atual = currentMonthKey();
  const detalhe: ResultadoJanela[] = [];
  let registros = 0;

  for (const entidade of alvos) {
    for (const janela of janelasIncrementais(entidade, atual, opts.mesesParaTras ?? 3)) {
      if (opts.signal?.aborted) break;
      const r = await sincronizarJanela(entidade, janela, { signal: opts.signal });
      detalhe.push(r);
      registros += r.registros;
    }
  }

  const [concluidas, pendentes] = await Promise.all([
    prisma.syncWindow.count({ where: { status: "CONCLUIDA" } }),
    prisma.syncWindow.count({ where: { status: { not: "CONCLUIDA" } } }),
  ]);

  return {
    janelasConcluidas: concluidas,
    janelasPendentes: pendentes,
    registros,
    requisicoes: requisicoesFeitas(),
    interrompida: false,
    detalhe,
  };
}

/** Quanto falta, por entidade — alimenta a tela de operação e o selo. */
export async function progressoDaCarga(): Promise<
  Array<{ entidade: Entidade; total: number; concluidas: number; pendentes: number; registros: number }>
> {
  const saida = [];
  for (const entidade of Object.keys(ENTIDADES) as Entidade[]) {
    const inicio = await prisma.syncState.findUnique({ where: { key: `janela-inicial:${entidade}` } });
    const total = inicio?.cursor ? gerarJanelas(inicio.cursor, currentMonthKey()).length : 0;
    const janelas = await prisma.syncWindow.findMany({ where: { entidade } });
    const concluidas = janelas.filter((j) => j.status === "CONCLUIDA").length;
    saida.push({
      entidade,
      total,
      concluidas,
      pendentes: Math.max(0, total - concluidas),
      registros: janelas.reduce((a, j) => a + j.registros, 0),
    });
  }
  return saida;
}
