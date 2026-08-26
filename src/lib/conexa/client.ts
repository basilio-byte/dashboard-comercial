import "server-only";
import { getEnv } from "@/lib/env";

/**
 * ============================ SOMENTE LEITURA ============================
 * O Dashboard Comercial **nunca escreve no Conexa**. O token é de admin e tem
 * privilégios altos; um POST/PATCH/DELETE acidental alteraria dados reais da
 * empresa — inclusive financeiros.
 *
 * A garantia é ESTRUTURAL, não uma promessa: `conexaFetch` tem o método fixo em
 * `GET` e **não expõe parâmetro `method` nem `body`**. Não existe caminho de
 * código capaz de escrever. Habilitar escrita exigiria editar este arquivo — o
 * que aparece numa revisão.
 *
 * (A escrita do comercial acontece no ClickUp, por outro cliente, com as
 * salvaguardas do ADR-0004.)
 * ========================================================================
 */

export class ConexaError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "ConexaError";
  }
}

type QueryValue = string | number | boolean | Array<string | number> | undefined | null;
export type Query = Record<string, QueryValue>;

export interface ConexaPage<T> {
  data?: T[];
  pagination?: { hasNext?: boolean; total?: number };
}

/**
 * Limitador de taxa: serializa as requisições com espaçamento mínimo.
 *
 * ⚠ Vale **por processo** — ver a nota do `globalThis` abaixo, que é o que
 * garante um único limitador dentro do processo.
 *
 * Teto medido da API: 60 req/min, janela de 60s. Medição de 2026-08-26 (22
 * janelas) mostrou **zero** consumo de terceiros: o financeiro em produção usa
 * login web, não a API v2. O ritmo configurado é um TETO, não um alvo — em
 * regime o comercial gasta ~50 requisições por dia. Ver ADR-0002.
 */
class RateLimiter {
  private queue: Promise<void> = Promise.resolve();
  private readonly minIntervalMs: number;
  private lastStart = 0;

  constructor(perMinute: number) {
    // margem de 5% para não encostar no teto
    this.minIntervalMs = Math.ceil((60_000 / perMinute) * 1.05);
  }

  schedule<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const wait = this.lastStart + this.minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      this.lastStart = Date.now();
    });
    this.queue = run.catch(() => {}); // erro do gate não trava a fila
    return run.then(task);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * ⚠ O singleton vive em `globalThis`, NÃO num `let` de módulo.
 *
 * O Next empacota a camada de route handler e a camada RSC/server action em
 * bundles SEPARADOS. Verificado no build deste projeto: `chunks/753.js` e
 * `chunks/918.js` contêm, cada um, uma cópia desta classe — `/api/sync` carrega
 * só o 918, `/reconciliacao` só o 753, `/operacao` os dois. Com um `let` de
 * módulo isso são DOIS limitadores independentes no mesmo processo Node, cada
 * um convencido de que tem o teto inteiro, e a taxa real vira 2× a configurada.
 *
 * É o mesmo motivo pelo qual `src/lib/db.ts` protege o Prisma com `globalThis`.
 * O bug ficou invisível em 15 req/min (2 × 14,3 = 28,6, abaixo de 60) e só
 * apareceria ao subir o ritmo — achado de auditoria adversarial.
 */
const CHAVE_LIMITER = Symbol.for("seahub.comercial.conexa.limiter");
type GlobalComLimiter = typeof globalThis & { [CHAVE_LIMITER]?: RateLimiter };

function getLimiter(): RateLimiter {
  const g = globalThis as GlobalComLimiter;
  if (!g[CHAVE_LIMITER]) g[CHAVE_LIMITER] = new RateLimiter(getEnv().CONEXA_RATE_LIMIT_PER_MIN);
  return g[CHAVE_LIMITER]!;
}

/**
 * Contador de requisições do processo. Também em `globalThis`, pelo mesmo
 * motivo do limitador: senão cada bundle conta as suas e a tela de operação
 * mostra um número menor que o real.
 */
const CHAVE_CONTADOR = Symbol.for("seahub.comercial.conexa.contador");
type GlobalComContador = typeof globalThis & { [CHAVE_CONTADOR]?: { n: number } };
function contador(): { n: number } {
  const g = globalThis as GlobalComContador;
  if (!g[CHAVE_CONTADOR]) g[CHAVE_CONTADOR] = { n: 0 };
  return g[CHAVE_CONTADOR]!;
}
export function requisicoesFeitas(): number {
  return contador().n;
}

/**
 * Último rate limit observado. Global pelo mesmo motivo do limitador.
 *
 * Era lido do header e jogado fora — o sistema tinha a informação para saber
 * que estava perto do teto e não a usava em lugar nenhum. Agora alimenta a tela
 * de operação e o freio preventivo abaixo.
 */
export interface RateLimitObservado {
  limite: number | null;
  restante: number | null;
  resetEmSegundos: number | null;
  em: string;
}
const CHAVE_RL = Symbol.for("seahub.comercial.conexa.ratelimit");
type GlobalComRL = typeof globalThis & { [CHAVE_RL]?: RateLimitObservado | null };
export function ultimoRateLimitObservado(): RateLimitObservado | null {
  return (globalThis as GlobalComRL)[CHAVE_RL] ?? null;
}

/** Abaixo disto, esperamos o reset em vez de insistir e tomar 429. */
const MARGEM_DE_FREIO = 3;

/**
 * Contador de 429 do processo.
 *
 * O ADR-0002 define como critério de validação "zero 429 por 7 dias corridos",
 * e não havia nada contando — o critério daria verde num sistema estourando o
 * teto o dia inteiro. Global pelo mesmo motivo do limitador.
 */
const CHAVE_429 = Symbol.for("seahub.comercial.conexa.429");
type GlobalCom429 = typeof globalThis & { [CHAVE_429]?: { n: number; ultimo: string | null } };
function contador429(): { n: number; ultimo: string | null } {
  const g = globalThis as GlobalCom429;
  if (!g[CHAVE_429]) g[CHAVE_429] = { n: 0, ultimo: null };
  return g[CHAVE_429]!;
}
export function respostas429(): { n: number; ultimo: string | null } {
  return { ...contador429() };
}



function buildUrl(path: string, query?: Query): string {
  const env = getEnv();
  const base = env.CONEXA_BASE_URL.replace(/\/$/, "");
  const url = new URL(`${base}/${path.replace(/^\//, "")}`);
  if (!query) return url.toString();

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      // Chave terminada em `[]` (ex.: `id[]`, `customerId[]`): a Conexa espera o
      // parâmetro REPETIDO — `id[]=1&id[]=2`. Juntar com vírgula devolve
      // silenciosamente o conjunto errado.
      if (key.endsWith("[]")) {
        for (const v of value) url.searchParams.append(key, String(v));
      } else if (value.length) {
        url.searchParams.set(key, value.join(","));
      }
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

/**
 * 7 tentativas com backoff ≈ 1+2+4+8+16+30 = ~61s de insistência.
 * O irmão perdeu um backfill de 3 horas para um `500` transitório com 15s de
 * paciência. A API oscila; insistir por ~1 min custa nada.
 */
const MAX_RETRIES = 7;
const REQUEST_TIMEOUT_MS = 30_000;

/** Requisição GET autenticada, com throttle e retry/backoff em 429/5xx. */
export async function conexaFetch<T>(
  path: string,
  opts: { query?: Query; signal?: AbortSignal } = {},
): Promise<T> {
  const env = getEnv();
  if (!env.CONEXA_API_TOKEN) {
    throw new ConexaError("CONEXA_API_TOKEN ausente — configure o token nas ENV do serviço.", 401);
  }
  const url = buildUrl(path, opts.query);

  let attempt = 0;
  for (;;) {
    attempt++;
    let result: Response;
    try {
      result = await getLimiter().schedule(async () => {
        contador().n++;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        if (opts.signal) opts.signal.addEventListener("abort", () => controller.abort());
        try {
          return await fetch(url, {
            method: "GET", // fixo — ver o bloco SOMENTE LEITURA no topo
            headers: {
              Authorization: `Bearer ${env.CONEXA_API_TOKEN}`,
              Accept: "application/json",
            },
            signal: controller.signal,
            cache: "no-store",
          });
        } finally {
          clearTimeout(timeout);
        }
      });
    } catch (err) {
      // Falha de REDE (ECONNRESET/DNS/TLS) ou o AbortError do timeout. Sem este
      // catch, uma requisição lenta derruba o backfill inteiro — aconteceu no
      // irmão, 6.830 registros perdidos aos 516s.
      if (opts.signal?.aborted) throw err; // cancelamento do chamador: não insistir
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt <= MAX_RETRIES) {
        await sleep(Math.min(30_000, 2 ** attempt * 500));
        continue;
      }
      throw new ConexaError(`Conexa GET ${path} → rede falhou após ${attempt} tentativas: ${msg}`, 0);
    }

    const limite = Number(result.headers.get("X-Rate-Limit-Limit"));
    const restante = Number(result.headers.get("X-Rate-Limit-Remaining"));
    const reset = Number(result.headers.get("X-Rate-Limit-Reset"));
    if (Number.isFinite(limite) || Number.isFinite(restante)) {
      (globalThis as GlobalComRL)[CHAVE_RL] = {
        limite: Number.isFinite(limite) ? limite : null,
        restante: Number.isFinite(restante) ? restante : null,
        resetEmSegundos: Number.isFinite(reset) ? reset : null,
        em: new Date().toISOString(),
      };
    }

    // FREIO PREVENTIVO. Um 429 custa ~56s de sono e sete tentativas; esperar o
    // reset quando o balde está quase vazio custa menos e é previsível. A
    // informação já vinha no header — só não era usada.
    if (Number.isFinite(restante) && restante <= MARGEM_DE_FREIO && Number.isFinite(reset) && reset > 0) {
      await sleep(reset * 1000 + 250);
    }

    if (result.status === 429) {
      const c = contador429();
      c.n++;
      c.ultimo = new Date().toISOString();
    }

    if (result.status === 429 && attempt <= MAX_RETRIES) {
      const reset = Number(
        result.headers.get("X-Rate-Limit-Reset") ?? result.headers.get("Retry-After") ?? 60,
      );
      await sleep((Number.isFinite(reset) ? reset : 60) * 1000 + 250);
      continue;
    }
    if (result.status >= 500 && attempt <= MAX_RETRIES) {
      await sleep(Math.min(30_000, 2 ** attempt * 500));
      continue;
    }

    if (!result.ok) {
      let body: unknown;
      try {
        body = await result.json();
      } catch {
        /* ignore */
      }
      throw new ConexaError(`Conexa GET ${path} → ${result.status}`, result.status, body);
    }

    if (result.status === 204) return undefined as T;
    return (await result.json()) as T;
  }
}

/**
 * Percorre as páginas de um recurso, uma PÁGINA por vez.
 *
 * Fim da listagem: `pagination.hasNext`, o sinal documentado. O heurístico
 * `items.length < limit` só é fallback — ele erra se a API devolver uma página
 * curta que não seja a última.
 *
 * Consumir por página (e não item a item) permite gravar em LOTE, que é o
 * gargalo real do backfill.
 *
 * `offsetInicial` existe para o backfill ser RETOMÁVEL (ADR-0008).
 */
export async function* paginatePages<T>(
  resource: string,
  query: Query = {},
  opts: { pageSize?: number; offsetInicial?: number; signal?: AbortSignal } = {},
): AsyncGenerator<{ itens: T[]; offset: number; proximoOffset: number }, void, unknown> {
  const limit = Math.min(Math.max(opts.pageSize ?? 100, 1), 100);
  let offset = opts.offsetInicial ?? 0;
  for (;;) {
    const page = await conexaFetch<ConexaPage<T> | T[]>(resource, {
      query: { ...query, limit, offset },
      signal: opts.signal,
    });
    const itens: T[] = Array.isArray(page) ? page : (page.data ?? []);
    const proximoOffset = offset + limit;

    if (itens.length > 0) yield { itens, offset, proximoOffset };

    const hasNext = Array.isArray(page) ? undefined : page.pagination?.hasNext;
    if (hasNext === false) break;
    if (hasNext === undefined && itens.length < limit) break; // fallback
    if (itens.length === 0) break; // proteção contra laço infinito
    offset = proximoOffset;
  }
}

/** Coleta todas as páginas num array. Só para recursos pequenos (dimensões). */
export async function collectAll<T>(resource: string, query: Query = {}): Promise<T[]> {
  const out: T[] = [];
  for await (const { itens } of paginatePages<T>(resource, query)) out.push(...itens);
  return out;
}

/** Busca registros por ID EXPLÍCITO — determinístico, não escorrega como o offset. */
export async function byIds<T>(resource: string, ids: number[]): Promise<T[]> {
  if (!ids.length) return [];
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const lote = ids.slice(i, i + 100);
    const page = await conexaFetch<ConexaPage<T> | T[]>(resource, {
      query: { "id[]": lote, limit: 100, offset: 0 },
    });
    out.push(...(Array.isArray(page) ? page : (page.data ?? [])));
  }
  return out;
}
