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
        elevada: "var(--elevada)",
        tinta: "var(--tinta)",
        "tinta-2": "var(--tinta-2)",
        "tinta-3": "var(--tinta-3)",
        borda: "var(--borda)",
        "borda-forte": "var(--borda-forte)",
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
        acento: "var(--acento)",
        "acento-forte": "var(--acento-forte)",
        "acento-tinta": "var(--acento-tinta)",
        "acento-wash": "var(--acento-wash)",
        marca: "var(--marca)",
        "marca-tinta": "var(--marca-tinta)",
        "marca-tinta-2": "var(--marca-tinta-2)",
        "marca-tinta-3": "var(--marca-tinta-3)",
      },
      fontFamily: {
        sans: ["var(--fonte)"],
      },
      borderRadius: {
        sm: "var(--raio-sm)",
        DEFAULT: "var(--raio)",
        lg: "var(--raio-lg)",
      },
      boxShadow: {
        1: "var(--sombra-1)",
        2: "var(--sombra-2)",
        3: "var(--sombra-3)",
      },
      backgroundImage: {
        // O painel lateral. Gradiente em vez de chapado.
        marca: "linear-gradient(168deg, var(--marca-topo) 0%, var(--marca-base) 100%)",
      },
    },
  },
  plugins: [],
} satisfies Config;
