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

/**
 * Classe de cor para variação. Sem base = neutro, nunca vermelho.
 *
 * ⚠ Usa os papéis do sistema, não cores cruas do Tailwind. A versão anterior
 * devolvia `text-emerald-700` / `text-red-700` / `text-neutral-400` — três
 * cores que não passaram por nenhuma validação de contraste e que, no modo
 * escuro, ficavam escuras sobre fundo escuro. Eram as únicas cores cruas que
 * sobreviveram no código, e apareciam justamente na coluna de variação, que é
 * onde o vendedor procura queda de receita.
 */
/**
 * Iniciais para o avatar.
 *
 * ⚠ Filtra o que não começa com letra. Sem isso, "Administrador (dev)" vira
 * `A(` — o parêntese entra como se fosse inicial de sobrenome.
 */
export function iniciais(nome: string): string {
  const letras = nome
    .split(/\s+/)
    .filter((p) => /^\p{L}/u.test(p))
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
  return letras || "?";
}

export function corVariacao(v: number | null | undefined): string {
  if (v === null || v === undefined) return "text-[var(--tinta-3)]";
  if (v > 0) return "text-[var(--bom-tinta)]";
  if (v < 0) return "text-[var(--critico-tinta)]";
  return "text-[var(--tinta-2)]";
}
