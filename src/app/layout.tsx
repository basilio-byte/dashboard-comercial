import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Seahub Comercial",
  description: "Dashboard de inteligência comercial da Seahub Coworking.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="bg-[var(--superficie-sutil)] text-[var(--tinta)] antialiased">{children}</body>
    </html>
  );
}
