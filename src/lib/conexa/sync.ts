import "server-only";
import { prisma } from "@/lib/db";
import { paginatePages, requisicoesFeitas } from "./client";
import { abrirRun, fecharRun, iniciarHeartbeat, type SyncMode } from "./run";
import {
  mapCharge,
  mapCompany,
  mapContract,
  mapCustomer,
  mapPlan,
  mapProduct,
  mapRoomBooking,
  mapSale,
  mapServiceCategory,
} from "./mappers";
import type {
  ConexaCharge,
  ConexaCompany,
  ConexaContract,
  ConexaCustomer,
  ConexaPlan,
  ConexaProduct,
  ConexaRoomBooking,
  ConexaSale,
  ConexaServiceCategory,
} from "./types";

/**
 * Sincronização do espelho local.
 *
 * Três propriedades que o projeto irmão pagou caro para aprender:
 *
 * 1. **Retomável.** O cursor de offset é persistido em `SyncState` a cada
 *    página. O container do Easypanel morre em todo redeploy; sem cursor, uma
 *    carga longa recomeça do zero e "o retrabalho come o ganho".
 * 2. **Idempotente.** Tudo por `upsert` na chave natural do Conexa.
 * 3. **Interrompível.** Um `AbortSignal` atravessa até o cliente HTTP, para o
 *    encerramento drenar em vez de ser morto no meio.
 */

// A contabilidade de execuções vive em `./run`, compartilhada com a carga por
// janela — que antes não registrava execução nenhuma. Reexportado aqui para não
// quebrar quem já importava daqui.
export { PROCESS_ID, enterrarZumbis, type SyncMode } from "./run";

export interface SyncResultado {
  runId: string;
  status: "SUCCESS" | "FAILED" | "HALTED";
  lidos: number;
  gravados: number;
  requisicoes: number;
  erro?: string;
}

interface Ctx {
  runId: string;
  signal?: AbortSignal;
  lidos: number;
  gravados: number;
}

// ---------------------------------------------------------------------------
// Cursor
// ---------------------------------------------------------------------------

async function lerCursor(key: string): Promise<number> {
  const s = await prisma.syncState.findUnique({ where: { key } });
  const n = Number(s?.cursor ?? 0);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

async function gravarCursor(key: string, offset: number): Promise<void> {
  await prisma.syncState.upsert({
    where: { key },
    create: { key, cursor: String(offset) },
    update: { cursor: String(offset) },
  });
}

async function limparCursor(key: string): Promise<void> {
  await prisma.syncState.deleteMany({ where: { key } });
}

// ---------------------------------------------------------------------------
// Motor genérico
// ---------------------------------------------------------------------------

interface EntidadeConfig<TApi> {
  /** Caminho do recurso na API (plural). */
  recurso: string;
  /** Nome curto, usado no cursor e no SyncRun. */
  nome: string;
  /** Traduz um registro; devolve `null` para descartar (sem id, por exemplo). */
  mapear: (item: TApi) => { conexaId: number } | null;
  /** Grava um lote já traduzido. */
  gravar: (linhas: Array<Record<string, unknown>>) => Promise<number>;
  query?: Record<string, string | number>;
}

/**
 * Percorre um recurso paginado e grava, com cursor retomável.
 *
 * `retomar: false` reinicia do offset 0 (uso do reconcile, que varre janelas
 * curtas); `true` continua de onde parou (uso do backfill).
 */
async function sincronizarEntidade<TApi>(
  cfg: EntidadeConfig<TApi>,
  ctx: Ctx,
  opts: { retomar: boolean; maxPaginas?: number },
): Promise<"SUCCESS" | "HALTED"> {
  const chaveCursor = `${cfg.nome}:offset`;
  const offsetInicial = opts.retomar ? await lerCursor(chaveCursor) : 0;
  let paginas = 0;

  for await (const { itens, proximoOffset } of paginatePages<TApi>(cfg.recurso, cfg.query ?? {}, {
    offsetInicial,
    signal: ctx.signal,
  })) {
    if (ctx.signal?.aborted) {
      // Encerramento pedido: o cursor já está gravado, então a próxima execução
      // continua exatamente daqui. Não é falha.
      return "HALTED";
    }

    ctx.lidos += itens.length;
    const linhas = itens.map(cfg.mapear).filter((x): x is { conexaId: number } => x !== null);
    ctx.gravados += await cfg.gravar(linhas as Array<Record<string, unknown>>);

    // Cursor DEPOIS de gravar: se o processo morrer entre as duas coisas, a
    // página é reprocessada — e o upsert torna isso inofensivo. O contrário
    // (cursor antes) pularia registros silenciosamente.
    if (opts.retomar) await gravarCursor(chaveCursor, proximoOffset);

    paginas++;
    if (opts.maxPaginas && paginas >= opts.maxPaginas) return "HALTED";
  }

  if (opts.retomar) await limparCursor(chaveCursor); // terminou: próxima carga recomeça
  return "SUCCESS";
}

/** Upsert em lote dentro de uma transação. */
function gravadorDe<T extends { conexaId: number }>(
  delegate: {
    upsert: (args: { where: { conexaId: number }; create: T; update: Omit<T, "conexaId"> }) => Promise<unknown>;
  },
) {
  return async (linhas: Array<Record<string, unknown>>): Promise<number> => {
    if (!linhas.length) return 0;
    const ops = linhas.map((linha) => {
      const { conexaId, ...resto } = linha as unknown as T;
      return delegate.upsert({
        where: { conexaId },
        create: linha as unknown as T,
        update: { ...resto, syncedAt: new Date() } as unknown as Omit<T, "conexaId">,
      });
    });
    await prisma.$transaction(ops as never);
    return linhas.length;
  };
}

// ---------------------------------------------------------------------------
// Rotinas públicas
// ---------------------------------------------------------------------------

/** Cadastros: mudam pouco, são pequenos, e tudo depende deles. */
export async function syncDimensoes(signal?: AbortSignal): Promise<SyncResultado> {
  const runId = await abrirRun("dimensions");
  const hb = iniciarHeartbeat(runId);
  const ctx: Ctx = { runId, signal, lidos: 0, gravados: 0 };
  try {
    await sincronizarEntidade<ConexaCompany>(
      { recurso: "companies", nome: "companies", mapear: mapCompany, gravar: gravadorDe(prisma.company as never) },
      ctx,
      { retomar: false },
    );
    await sincronizarEntidade<ConexaServiceCategory>(
      {
        recurso: "serviceCategories",
        nome: "serviceCategories",
        mapear: mapServiceCategory,
        gravar: gravadorDe(prisma.serviceCategory as never),
      },
      ctx,
      { retomar: false },
    );
    await sincronizarEntidade<ConexaPlan>(
      { recurso: "plans", nome: "plans", mapear: mapPlan, gravar: gravadorDe(prisma.plan as never) },
      ctx,
      { retomar: false },
    );
    await sincronizarEntidade<ConexaProduct>(
      { recurso: "products", nome: "products", mapear: mapProduct, gravar: gravadorDe(prisma.product as never) },
      ctx,
      { retomar: false },
    );
    await fecharRun(runId, "SUCCESS", ctx);
    return { runId, status: "SUCCESS", lidos: ctx.lidos, gravados: ctx.gravados, requisicoes: requisicoesFeitas() };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await fecharRun(runId, "FAILED", ctx, msg);
    return { runId, status: "FAILED", lidos: ctx.lidos, gravados: ctx.gravados, requisicoes: requisicoesFeitas(), erro: msg };
  } finally {
    clearInterval(hb);
  }
}

/**
 * Backfill das entidades grandes. Retomável — pode ser interrompido e continua.
 * `maxPaginasPorEntidade` existe para caber numa janela de execução sem monopolizar
 * o rate limit compartilhado.
 */
export async function syncBackfill(
  opts: {
    maxPaginasPorEntidade?: number;
    signal?: AbortSignal;
    /**
     * Restringe a carga a estas entidades. Sem isto, a ordem é sempre a mesma e
     * quem está no fim da fila (reservas) só começa depois de tudo antes dela
     * terminar — o que, no ritmo conservador de 15 req/min, são horas. Poder
     * priorizar é requisito de operação, não conveniência.
     */
    entidades?: string[];
  } = {},
): Promise<SyncResultado> {
  const runId = await abrirRun("backfill");
  const hb = iniciarHeartbeat(runId);
  const ctx: Ctx = { runId, signal: opts.signal, lidos: 0, gravados: 0 };
  let status: "SUCCESS" | "HALTED" = "SUCCESS";
  try {
    const todas = [
      { recurso: "customers", nome: "customers", mapear: mapCustomer, gravar: gravadorDe(prisma.customer as never) },
      { recurso: "contracts", nome: "contracts", mapear: mapContract, gravar: gravadorDe(prisma.contract as never) },
      { recurso: "charges", nome: "charges", mapear: mapCharge, gravar: gravadorDe(prisma.charge as never) },
      { recurso: "sales", nome: "sales", mapear: mapSale, gravar: gravadorDe(prisma.sale as never) },
      {
        recurso: "room/bookings",
        nome: "bookings",
        mapear: mapRoomBooking,
        gravar: gravadorDe(prisma.roomBooking as never),
      },
    ];
    const entidades = opts.entidades?.length
      ? todas.filter((e) => opts.entidades!.includes(e.nome))
      : todas;
    if (!entidades.length) {
      throw new Error(
        `Nenhuma entidade conhecida em [${opts.entidades?.join(", ")}]. Válidas: ${todas.map((e) => e.nome).join(", ")}.`,
      );
    }
    for (const e of entidades) {
      const r = await sincronizarEntidade(e as never, ctx, {
        retomar: true,
        maxPaginas: opts.maxPaginasPorEntidade,
      });
      if (r === "HALTED") {
        status = "HALTED";
        break; // o cursor guardou o ponto; a próxima execução continua
      }
    }
    await fecharRun(runId, status, ctx);
    return { runId, status, lidos: ctx.lidos, gravados: ctx.gravados, requisicoes: requisicoesFeitas() };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await fecharRun(runId, "FAILED", ctx, msg);
    return { runId, status: "FAILED", lidos: ctx.lidos, gravados: ctx.gravados, requisicoes: requisicoesFeitas(), erro: msg };
  } finally {
    clearInterval(hb);
  }
}

/** true quando o backfill de alguma entidade está pela metade. */
export async function backfillPendente(): Promise<string[]> {
  const estados = await prisma.syncState.findMany({ where: { key: { endsWith: ":offset" } } });
  return estados.map((e) => e.key.replace(":offset", ""));
}

export type { ConexaCharge, ConexaContract, ConexaCustomer, ConexaRoomBooking, ConexaSale };
