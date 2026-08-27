import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { requisicoesFeitas } from "./client";

/**
 * CONTABILIDADE DE EXECUÇÕES (`SyncRun`).
 *
 * ⚠ Extraído de `sync.ts` porque a carga por janela — que é o que o agendador
 * de fato passa o dia fazendo — **não registrava execução nenhuma**. As duas
 * consequências apareceram em produção:
 *
 * 1. "Execuções recentes", na tela Motor, listava só cadastros e consolidação.
 *    O agendador podia estar trabalhando perfeitamente e a tela mostrava a
 *    mesma coisa há horas — indistinguível de um agendador morto, que é
 *    exatamente o modo de falha que o projeto inteiro tenta não ter.
 * 2. O selo "sincronizado HH:MM" na barra superior lê o último run com
 *    sucesso. Sem run da carga, ele carimbava a hora da última consolidação —
 *    ou seja, **respondia a pergunta errada** com cara de resposta certa.
 *
 * O `ownerId` + `heartbeatAt` existem para enterrar zumbi por batida perdida, e
 * não por "existe um RUNNING" — ver ADR-0003.
 */

/** Identidade deste processo. Muda a cada boot, de propósito. */
export const PROCESS_ID = randomUUID();

export const HEARTBEAT_MS = 30_000;

export type SyncMode =
  | "dimensions"
  | "backfill"
  | "incremental"
  /**
   * Revarredura profunda: relê janelas ANTIGAS atrás de registro que mudou de
   * conteúdo depois de carregado (venda cancelada meses depois, reserva que
   * virou `cancelled`, cliente bloqueado). Roda uma vez por dia.
   *
   * Modo separado do `incremental` por causa da tela: os dois leem as mesmas
   * entidades, mas um custa dezenas de requisições e o outro centenas. Sem
   * nome próprio, a passada diária apareceria como um `incremental` estranho e
   * caro, e a primeira reação seria procurar defeito onde não há.
   */
  | "revisita"
  | "reconcile"
  | "intelligence";

export interface TotaisDoRun {
  lidos: number;
  gravados: number;
}

/**
 * Requisições já feitas quando cada run abriu.
 *
 * ⚠ `requisicoesFeitas()` conta o PROCESSO inteiro, não o run. Gravar o valor
 * bruto fazia a coluna "Req." somar o consumo de tudo que rodou antes no mesmo
 * container — o primeiro run do processo saía certo e os seguintes iam
 * inflando. Guardando o ponto de partida, o que a tela mostra é o custo
 * daquela execução.
 */
const inicioDeRequisicoes = new Map<string, number>();

export async function abrirRun(mode: SyncMode, entity?: string): Promise<string> {
  const run = await prisma.syncRun.create({
    data: { mode, entity: entity ?? null, ownerId: PROCESS_ID, heartbeatAt: new Date() },
  });
  inicioDeRequisicoes.set(run.id, requisicoesFeitas());
  return run.id;
}

/** Requisições consumidas por este run até agora. */
function requisicoesDoRun(runId: string): number {
  return requisicoesFeitas() - (inicioDeRequisicoes.get(runId) ?? 0);
}

export async function fecharRun(
  runId: string,
  status: "SUCCESS" | "FAILED" | "HALTED",
  totais: TotaisDoRun,
  erro?: string,
  /**
   * O que a execução TOCOU. `SyncRun.detail` existe no schema desde o começo e
   * nunca foi preenchido — então "quais janelas este backfill leu?" não tinha
   * resposta, e a única saída era adivinhar.
   *
   * Apareceu como problema concreto: com a carga completa, o backfill continua
   * gastando requisições a cada ciclo, e sem o detalhe não dá para dizer se ele
   * está revisitando algo, retentando uma janela que falha em silêncio, ou
   * varrendo mês que não existe.
   */
  detalhe?: unknown,
): Promise<void> {
  await prisma.syncRun.update({
    where: { id: runId },
    data: {
      status,
      finishedAt: new Date(),
      recordsRead: totais.lidos,
      recordsWrote: totais.gravados,
      requestsMade: requisicoesDoRun(runId),
      error: erro ?? null,
      detail: detalhe === undefined ? undefined : (detalhe as never),
    },
  });
  inicioDeRequisicoes.delete(runId);
}

/**
 * Batida de vida do run — e, com `progresso`, também o progresso parcial.
 *
 * ⚠ Sem o progresso parcial, um run RUNNING mostrava **0 lidos, 0 gravados, 0
 * req.** na tela: os contadores só eram escritos no fecho. Uma execução de 8,5
 * minutos passava esse tempo todo parecendo não ter feito nada — a mesma
 * confusão de "parece parado" que a tela de progresso já tinha, um nível
 * abaixo. Como a batida já escreve no banco a cada 30s, levar os números junto
 * não custa consulta nenhuma a mais.
 */
export function iniciarHeartbeat(
  runId: string,
  progresso?: () => TotaisDoRun,
): NodeJS.Timeout {
  const t = setInterval(() => {
    const p = progresso?.();
    prisma.syncRun
      .update({
        where: { id: runId },
        data: {
          heartbeatAt: new Date(),
          ...(p
            ? {
                recordsRead: p.lidos,
                recordsWrote: p.gravados,
                requestsMade: requisicoesDoRun(runId),
              }
            : {}),
        },
      })
      .catch(() => {});
  }, HEARTBEAT_MS);
  // Não segurar o processo aberto só por causa do heartbeat.
  t.unref?.();
  return t;
}

/**
 * Enterra runs zumbis: `RUNNING` cujo heartbeat parou há mais de 3 batidas.
 *
 * ⚠ Por HEARTBEAT, não por "existe um RUNNING". O irmão marca todo RUNNING como
 * falho no boot, o que só está correto sob a premissa "um container só" — com
 * duas réplicas, o boot da segunda mata o backfill vivo da primeira. Ver
 * ADR-0003.
 *
 * ⚠ **Precisa rodar PERIODICAMENTE, não só no boot.** Rodando apenas no boot,
 * a varredura acontecia no único instante em que não podia funcionar: o
 * container morre no redeploy com o heartbeat recém-batido, o processo novo
 * sobe segundos depois e vê uma batida de 10s atrás — dentro do limite de 90s,
 * logo "vivo". Nunca mais varria, e o run ficava RUNNING para sempre.
 *
 * Observado em produção: dois runs presos em RUNNING desde 19:00 depois de
 * três redeploys seguidos, enquanto o run de verdade rodava ao lado. Uma tela
 * com três execuções "em andamento" simultâneas não diz nada a ninguém.
 */
export async function enterrarZumbis(): Promise<number> {
  const limite = new Date(Date.now() - HEARTBEAT_MS * 3);
  const r = await prisma.syncRun.updateMany({
    where: { status: "RUNNING", OR: [{ heartbeatAt: { lt: limite } }, { heartbeatAt: null }] },
    data: {
      status: "FAILED",
      finishedAt: new Date(),
      error: "Processo morreu sem encerrar o run (heartbeat vencido).",
    },
  });
  return r.count;
}
