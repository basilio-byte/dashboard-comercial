import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Formata percentual com sinal. `null` vira o traço de "sem base". */
export function pct(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const s = v > 0 ? "+" : "";
  return `${s}${v.toFixed(1).replace(".", ",")}%`;
}

/** Classe de cor para variação. Sem base = neutro, nunca vermelho. */
export function corVariacao(v: number | null | undefined): string {
  if (v === null || v === undefined) return "text-neutral-400";
  if (v > 0) return "text-emerald-700";
  if (v < 0) return "text-red-700";
  return "text-neutral-500";
}
