import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

/**
 * Inter, servida do próprio domínio.
 *
 * ⚠ Vem de `@fontsource-variable/inter` no node_modules, e **não** de
 * `next/font/google`. A diferença importa no deploy: a variante do Google
 * baixa o arquivo em tempo de build, então uma falha de rede no runner
 * derruba a imagem. O pacote npm já está no lock — o build fica offline.
 */
const inter = localFont({
  src: "../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
  variable: "--fonte-inter",
  display: "swap",
  weight: "100 900",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "sans-serif"],
});

export const metadata: Metadata = {
  title: "Seahub Comercial",
  description: "Dashboard de inteligência comercial da Seahub Coworking.",
};

// Acompanha o esquema escolhido: sem isto, a barra do navegador no celular
// fica clara sobre um painel escuro.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f4f1" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0d0d" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
