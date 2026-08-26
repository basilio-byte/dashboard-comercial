"use server";
import { revalidatePath } from "next/cache";
import { usuarioAtual } from "@/lib/auth/session";
import { syncBackfill, syncDimensoes } from "@/lib/conexa/sync";
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
  // Teto de páginas por execução: a carga cabe numa janela e não monopoliza o
  // rate limit compartilhado com o financeiro. Retomável — basta rodar de novo.
  const r = await syncBackfill({ maxPaginasPorEntidade: 25, entidades });
  revalidatePath("/operacao");
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
