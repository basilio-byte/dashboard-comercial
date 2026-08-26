import type { Config } from "tailwindcss";

/**
 * As cores vêm de custom properties definidas em globals.css, para os dois
 * modos trocarem num lugar só. Aqui elas só ganham nomes semânticos — a UI é
 * escrita contra PAPÉIS ("tinta-2", "critico"), nunca contra hex.
 */
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        plano: "var(--plano)",
        superficie: "var(--superficie)",
        "superficie-sutil": "var(--superficie-sutil)",
        tinta: "var(--tinta)",
        "tinta-2": "var(--tinta-2)",
        "tinta-3": "var(--tinta-3)",
        borda: "var(--borda)",
        linha: "var(--linha)",
        bom: "var(--bom)",
        "bom-tinta": "var(--bom-tinta)",
        atencao: "var(--atencao)",
        "atencao-tinta": "var(--atencao-tinta)",
        serio: "var(--serio)",
        critico: "var(--critico)",
        "critico-tinta": "var(--critico-tinta)",
        "serie-1": "var(--serie-1)",
        "serie-2": "var(--serie-2)",
        "serie-3": "var(--serie-3)",
      },
    },
  },
  plugins: [],
} satisfies Config;
