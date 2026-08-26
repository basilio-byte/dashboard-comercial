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
  | "reconcile"
  | "intelligence";

export interface TotaisDoRun {
  lidos: number;
  gravados: number;
}

export async function abrirRun(mode: SyncMode, entity?: string): Promise<string> {
  const run = await prisma.syncRun.create({
    data: { mode, entity: entity ?? null, ownerId: PROCESS_ID, heartbeatAt: new Date() },
  });
  return run.id;
}

export async function fecharRun(
  runId: string,
  status: "SUCCESS" | "FAILED" | "HALTED",
  totais: TotaisDoRun,
  erro?: string,
): Promise<void> {
  await prisma.syncRun.update({
    where: { id: runId },
    data: {
      status,
      finishedAt: new Date(),
      recordsRead: totais.lidos,
      recordsWrote: totais.gravados,
      requestsMade: requisicoesFeitas(),
      error: erro ?? null,
    },
  });
}

export function iniciarHeartbeat(runId: string): NodeJS.Timeout {
  const t = setInterval(() => {
    prisma.syncRun
      .update({ where: { id: runId }, data: { heartbeatAt: new Date() } })
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
