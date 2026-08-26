import "server-only";
import { prisma } from "@/lib/db";
import { paginatePages, requisicoesFeitas } from "./client";
import { abrirRun, fecharRun, iniciarHeartbeat } from "./run";
import { currentMonthKey } from "@/lib/dates";
import {
  ENTIDADES,
  ORDEM_DE_CARGA,
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
// Descoberta do fundo do histórico
// ---------------------------------------------------------------------------

/**
 * ⚠ A API do Conexa **NÃO devolve os registros em ordem** — nem por id, nem por
 * data. Medido em `/room/bookings`:
 *
 *   offset     0 → bookingId  8626, criado em 2024-12-18
 *   offset  5000 → bookingId  1384, criado em 2024-03-21   ← mais ANTIGO
 *   offset 20000 → bookingId 24043, criado em 2026-05-29
 *   offset 21000 → bookingId 22921, criado em 2026-04-22   ← volta atrás
 *
 * A versão anterior descobria o início do histórico lendo `offset: 0` e
 * assumindo que era o registro mais antigo. Como a ordem não existe, ela pegou
 * 2024-12 quando havia dado de 2024-03 — e a carga **pulou nove meses em
 * silêncio**: 15.647 registros carregados contra ~21.400 existentes.
 *
 * Foi o próprio desenho por janelas que tornou o buraco visível (deu para
 * comparar o carregado com o total sondado). O cursor de offset global teria
 * escondido isso.
 *
 * Agora não há descoberta: a carga **anda para trás** a partir do mês corrente
 * e para depois de N janelas consecutivas vazias. Não assume ordem nenhuma.
 */
const JANELAS_VAZIAS_PARA_PARAR = 6;
const MAX_JANELAS_HISTORICO = 240; // 20 anos — trava contra laço infinito

/** Gera janelas do mês corrente para trás. */
function janelasParaTras(quantas: number): string[] {
  const [ano, mes] = currentMonthKey().split("-").map(Number);
  const out: string[] = [];
  for (let i = 0; i < quantas; i++) {
    const d = new Date(Date.UTC(ano!, mes! - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
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
  /**
   * ⚠ Zera quando a varredura recomeça do início.
   *
   * `registros` partia SEMPRE do valor já gravado e somava em cima. Numa janela
   * já CONCLUIDA o offset é zerado de propósito (para a janela ser
   * re-verificável), então reprocessá-la varria tudo de novo e **somava o
   * conteúdo inteiro outra vez**. E quem reprocessa é o incremental, a cada 30
   * minutos, nas janelas recentes das entidades mutáveis.
   *
   * O efeito medido em produção: contratos com 2.931 linhas no espelho
   * exibindo 3.133 "registros" — e subindo a cada passada do incremental, sem
   * teto. Um número que cresce sozinho é pior que um número errado: ele parece
   * progresso.
   *
   * Retomada no meio da janela (offset > 0) preserva a contagem parcial, que é
   * o caso para o qual o campo existe.
   */
  let registros = offset === 0 ? 0 : registro.registros;
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
    /**
     * Orçamento de TEMPO. Substitui o teto de janelas como freio principal.
     *
     * ⚠ Contar janelas era medir a coisa errada. Uma janela custa de 1 a 5
     * requisições dependendo do volume do mês, então "20 janelas" tanto podia
     * gastar 20 requisições quanto 100 — e o teto foi calibrado pelo pior caso.
     * Medido em produção: o agendador usava 6–18% do orçamento de requisições
     * disponível entre um ciclo e o outro, e a carga que caberia em ~40min
     * levava horas. Com prazo, a execução usa o que tem e o limitador de taxa
     * continua sendo quem protege a API.
     */
    orcamentoMs?: number;
    signal?: AbortSignal;
  } = {},
): Promise<ResultadoCarga> {
  const alvos = opts.entidades ?? ORDEM_DE_CARGA;
  // Sem prazo, mantém o teto de janelas — é o modo do clique manual, que precisa
  // caber na duração de um request.
  const teto = opts.maxJanelas ?? (opts.orcamentoMs ? Number.POSITIVE_INFINITY : 12);
  const prazo = comPrazo(opts.signal, opts.orcamentoMs);
  const detalhe: ResultadoJanela[] = [];
  let registros = 0;
  let interrompida = false;

  // ⚠ Registrar a execução não é telemetria opcional. Sem isto, a carga que o
  // agendador roda o dia inteiro NÃO aparecia em "Execuções recentes" nem movia
  // o selo de frescura da barra superior: a tela ficava idêntica por horas, e
  // "trabalhando" virava indistinguível de "morto" — exatamente o modo de falha
  // silencioso que o resto do projeto se esforça para tornar impossível.
  const runId = await abrirRun("backfill", alvos.join(","));
  const hb = iniciarHeartbeat(runId);

  try {
    for (const entidade of alvos) {
      const feitas = await prisma.syncWindow.findMany({
        where: { entidade },
        select: { janela: true, status: true, registros: true },
      });
      const porJanela = new Map(feitas.map((f) => [f.janela, f]));

      // Já sabemos onde é o fundo? Então não precisa procurar de novo.
      const fundo = await prisma.syncState.findUnique({
        where: { key: `fundo:${entidade}` },
      });

      let vaziasSeguidas = 0;
      for (const janela of janelasParaTras(MAX_JANELAS_HISTORICO)) {
        if (fundo?.cursor && janela < fundo.cursor) break; // além do fundo conhecido

        const ja = porJanela.get(janela);
        if (ja?.status === "CONCLUIDA") {
          // Conta o vazio mesmo em janela já feita: é assim que o fundo é
          // reconhecido numa segunda execução.
          vaziasSeguidas = ja.registros === 0 ? vaziasSeguidas + 1 : 0;
          if (vaziasSeguidas >= JANELAS_VAZIAS_PARA_PARAR) {
            await marcarFundo(entidade, janela);
            break;
          }
          continue;
        }

        if (detalhe.length >= teto || prazo.signal?.aborted) {
          interrompida = true;
          break;
        }

        const r = await sincronizarJanela(entidade, janela, {
          maxPaginas: opts.maxPaginasPorJanela,
          // Prazo, não o sinal cru: assim a interrupção também corta a paginação
          // no MEIO de uma janela grande. Sem isso, uma janela de 5 páginas
          // estouraria o orçamento em até 5 requisições.
          signal: prazo.signal,
        });
        detalhe.push(r);
        registros += r.registros;
        if (r.status === "FALHOU") break;

        vaziasSeguidas = r.status === "CONCLUIDA" && r.registros === 0 ? vaziasSeguidas + 1 : 0;
        if (vaziasSeguidas >= JANELAS_VAZIAS_PARA_PARAR) {
          await marcarFundo(entidade, janela);
          break;
        }
      }
      if (interrompida) break;
    }

    prazo.limpar();

    const [concluidas, pendentes] = await Promise.all([
      prisma.syncWindow.count({ where: { status: "CONCLUIDA" } }),
      prisma.syncWindow.count({ where: { status: { not: "CONCLUIDA" } } }),
    ]);

    // HALTED quando o prazo cortou — é o freio funcionando, não falha. A tela
    // já explica que HALTED significa "continua de onde parou".
    await fecharRun(runId, interrompida ? "HALTED" : "SUCCESS", {
      lidos: registros,
      gravados: registros,
    });

    return {
      janelasConcluidas: concluidas,
      janelasPendentes: pendentes,
      registros,
      requisicoes: requisicoesFeitas(),
      // Com orçamento de tempo, `interrompida: true` passa a ser o caso NORMAL,
      // e não sinal de erro: o progresso fica gravado por janela e a próxima
      // execução continua exatamente de onde parou.
      interrompida,
      detalhe,
    };
  } catch (err) {
    prazo.limpar();
    const msg = err instanceof Error ? err.message : String(err);
    await fecharRun(runId, "FAILED", { lidos: registros, gravados: registros }, msg);
    throw err;
  } finally {
    clearInterval(hb);
  }
}

/**
 * Combina o sinal do chamador com um prazo.
 *
 * Escrito à mão em vez de `AbortSignal.any` + `AbortSignal.timeout` para não
 * depender da versão do runtime — e porque o `clearTimeout` importa: um
 * temporizador pendurado segura o processo vivo entre as execuções do
 * agendador.
 */
function comPrazo(
  signal: AbortSignal | undefined,
  orcamentoMs: number | undefined,
): { signal: AbortSignal | undefined; limpar: () => void } {
  if (!orcamentoMs) return { signal, limpar: () => {} };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), orcamentoMs);
  signal?.addEventListener("abort", () => ctrl.abort(), { once: true });
  return { signal: ctrl.signal, limpar: () => clearTimeout(t) };
}

async function marcarFundo(entidade: Entidade, janela: string): Promise<void> {
  await prisma.syncState.upsert({
    where: { key: `fundo:${entidade}` },
    create: { key: `fundo:${entidade}`, cursor: janela },
    update: { cursor: janela },
  });
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

  // Também registra execução: é o que mantém o selo de frescura respondendo
  // "os dados são de agora?" em regime, quando a carga histórica já terminou e
  // só o incremental segue rodando.
  const runId = await abrirRun("incremental", alvos.join(","));
  const hb = iniciarHeartbeat(runId);

  try {
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

    await fecharRun(runId, "SUCCESS", { lidos: registros, gravados: registros });

    return {
      janelasConcluidas: concluidas,
      janelasPendentes: pendentes,
      registros,
      requisicoes: requisicoesFeitas(),
      interrompida: false,
      detalhe,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await fecharRun(runId, "FAILED", { lidos: registros, gravados: registros }, msg);
    throw err;
  } finally {
    // ⚠ Sem isto o heartbeat continuaria batendo por um run morto, e
    // `enterrarZumbis` — que decide por batida vencida — nunca o enterraria.
    clearInterval(hb);
  }
}

/**
 * As janelas que COMPÕEM o histórico de uma entidade: do fundo até o mês
 * corrente. `null` enquanto o fundo não foi achado — desconhecido não é lista.
 *
 * ⚠ Existe para separar "janela do período" de "janela que existe na tabela".
 * Elas não são a mesma coisa: para entidade MUTÁVEL, `janelasIncrementais`
 * cria também a janela do **mês seguinte** (um vencimento pode ser empurrado
 * para frente). Essa janela fecha como CONCLUIDA e ficava contada.
 *
 * Sintoma visível: contratos exibindo **83/82** janelas — mais concluídas do
 * que existem. O problema de verdade estava embaixo: `estadoDoEspelho` carimba
 * "completa" com `concluidas >= totais`, então uma janela histórica faltando
 * podia ser compensada pela janela futura e a entidade seria declarada
 * completa **sem estar**. Isso fura a garantia central do projeto — o selo de
 * completude é a coisa que autoriza um número a virar fato.
 */
/** Linhas distintas de cada entidade no espelho. */
const CONTADOR_LINHAS: Record<Entidade, () => Promise<number>> = {
  customers: () => prisma.customer.count(),
  contracts: () => prisma.contract.count(),
  charges: () => prisma.charge.count(),
  sales: () => prisma.sale.count(),
  bookings: () => prisma.roomBooking.count(),
};

export function janelasDoPeriodo(fundo: string | null): Set<string> | null {
  if (!fundo) return null;
  return new Set(gerarJanelas(fundo, currentMonthKey()));
}

/**
 * Sinal de vida da carga.
 *
 * ⚠ Responde "está trabalhando AGORA?", que é diferente de "quando terminou a
 * última execução?". `SyncWindow.atualizadaEm` é `@updatedAt`, então cada
 * página gravada o move — é o pulso mais fino que existe, muito antes de uma
 * janela fechar ou de um run encerrar.
 *
 * Sem isto a tela Motor era estática: números idênticos por minutos, e nenhuma
 * forma de distinguir "carregando uma janela grande" de "agendador morto".
 */
export async function pulsoDaCarga(): Promise<{
  ultimaEscrita: Date | null;
  janelaEmAndamento: { entidade: string; janela: string } | null;
  pendentes: number;
}> {
  const [agg, emAndamento, pendentes] = await Promise.all([
    prisma.syncWindow.aggregate({ _max: { atualizadaEm: true } }),
    prisma.syncWindow.findFirst({
      where: { status: "EM_ANDAMENTO" },
      orderBy: { atualizadaEm: "desc" },
      select: { entidade: true, janela: true },
    }),
    prisma.syncWindow.count({ where: { status: { not: "CONCLUIDA" } } }),
  ]);

  return {
    ultimaEscrita: agg._max.atualizadaEm ?? null,
    janelaEmAndamento: emAndamento,
    pendentes,
  };
}

/**
 * Progresso por entidade.
 *
 * Enquanto o fundo do histórico não foi encontrado, o total é DESCONHECIDO — e
 * é reportado como tal, não como um número que dá a impressão de completude.
 */
export async function progressoDaCarga(): Promise<
  Array<{
    entidade: Entidade;
    fundoConhecido: boolean;
    total: number | null;
    concluidas: number;
    /** Somatório do que foi LIDO da API por janela. */
    registros: number;
    /** Linhas distintas no espelho. É este que bate com o cartão do topo. */
    linhas: number;
  }>
> {
  const saida = [];
  for (const entidade of Object.keys(ENTIDADES) as Entidade[]) {
    const fundo = await prisma.syncState.findUnique({ where: { key: `fundo:${entidade}` } });
    const janelas = await prisma.syncWindow.findMany({ where: { entidade } });
    const doPeriodo = janelasDoPeriodo(fundo?.cursor ?? null);
    const concluidas = janelas.filter(
      (j) => j.status === "CONCLUIDA" && (!doPeriodo || doPeriodo.has(j.janela)),
    ).length;
    saida.push({
      entidade,
      fundoConhecido: Boolean(fundo?.cursor),
      total: doPeriodo ? doPeriodo.size : null,
      concluidas,
      registros: janelas.reduce((a, j) => a + j.registros, 0),
      // ⚠ Mostrar as duas ao lado é deliberado. "Lidos" é maior que "linhas"
      // por um motivo REAL e documentado — a paginação do Conexa repete
      // registro entre páginas (a API não devolve em ordem), e o upsert
      // colapsa. Sem as duas colunas juntas, a diferença parecia erro; com
      // elas, é conferível.
      linhas: await CONTADOR_LINHAS[entidade](),
    });
  }
  return saida;
}
