"use server";
import { revalidatePath } from "next/cache";
import { usuarioAtual } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { syncDimensoes } from "@/lib/conexa/sync";
import { cargaHistorica, sincronizarIncremental } from "@/lib/conexa/sync-janelas";
import type { Entidade } from "@/lib/conexa/janelas";
import { consolidarTudo } from "@/lib/intel/consolidar";
import { reconciliarMes, type ResultadoReconciliacao } from "@/lib/intel/reconciliar";

/** Toda ação de operação exige ADMIN. */
async function exigirAdmin() {
  const u = await usuarioAtual();
  if (!u || u.role !== "ADMIN") throw new Error("Ação restrita a administradores.");
  return u;
}

export async function acaoSincronizarCadastros() {
  await exigirAdmin();
  const r = await syncDimensoes();
  revalidatePath("/motor");
  return r;
}

export async function acaoBackfill(entidades?: string[]) {
  await exigirAdmin();
  // Teto de JANELAS por execução: cabe no tempo de um request e o progresso
  // fica gravado por janela, então rodar de novo continua de onde parou.
  const r = await cargaHistorica({
    entidades: entidades as Entidade[] | undefined,
    maxJanelas: 8,
  });
  revalidatePath("/motor");
  return r;
}

export async function acaoIncremental() {
  await exigirAdmin();
  const r = await sincronizarIncremental();
  revalidatePath("/motor");
  revalidatePath("/");
  return r;
}

export async function acaoConsolidar() {
  await exigirAdmin();
  const r = await consolidarTudo();
  revalidatePath("/motor");
  revalidatePath("/");
  return r;
}

export async function acaoReconciliar(mesKey: string): Promise<ResultadoReconciliacao> {
  const u = await exigirAdmin();
  const r = await reconciliarMes(mesKey);

  // ⚠ Grava ANTES de devolver. O resultado vivia só no estado da tela e sumia
  // no primeiro F5 — uma conferência que custa minutos e dezenas de requisições
  // não deixava rastro nenhum. Sem registro, ninguém sabe se a última foi ontem
  // ou nunca, e afirmação sobre correção sem data não vale nada.
  //
  // Falha de gravação NÃO derruba a conferência: o número na tela é o produto,
  // o histórico é o bônus.
  try {
    await prisma.reconciliacao.create({
      data: {
        mesKey: r.mesKey,
        janela: r.janela,
        executadaPor: u.email,
        veredicto: r.veredicto,
        localTotal: r.localTotal,
        localContagem: r.localContagem,
        remotoTotal: r.remotoTotal,
        remotoContagem: r.remotoContagem,
        diferenca: r.diferenca,
        divergencias: r.divergencias.length,
        detalhe: r.divergencias.length ? (r.divergencias as never) : undefined,
        requisicoes: r.requisicoes,
        observacao: r.observacao ?? null,
      },
    });
    revalidatePath("/confianca");
  } catch (err) {
    console.error("[reconciliar] falhou ao gravar o histórico:", err);
  }

  return r;
}
