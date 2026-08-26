"use server";
import { revalidatePath } from "next/cache";
import { usuarioAtual } from "@/lib/auth/session";
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
  revalidatePath("/operacao");
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
  revalidatePath("/operacao");
  return r;
}

export async function acaoIncremental() {
  await exigirAdmin();
  const r = await sincronizarIncremental();
  revalidatePath("/operacao");
  revalidatePath("/");
  return r;
}

export async function acaoConsolidar() {
  await exigirAdmin();
  const r = await consolidarTudo();
  revalidatePath("/operacao");
  revalidatePath("/");
  return r;
}

export async function acaoReconciliar(mesKey: string): Promise<ResultadoReconciliacao> {
  await exigirAdmin();
  return reconciliarMes(mesKey);
}
