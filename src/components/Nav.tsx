"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/ui";

const ITENS = [
  { href: "/", rotulo: "Panorama" },
  { href: "/clientes", rotulo: "Clientes" },
  { href: "/receita", rotulo: "Receita" },
  { href: "/reconciliacao", rotulo: "Reconciliação" },
  { href: "/validacao", rotulo: "Validação" },
  { href: "/operacao", rotulo: "Operação" },
];

export function Nav() {
  const caminho = usePathname();

  return (
    <nav className="flex items-center gap-0.5 overflow-x-auto">
      {ITENS.map((i) => {
        // "/" só marca ativo em correspondência exata, senão marcaria em tudo.
        const ativo = i.href === "/" ? caminho === "/" : caminho.startsWith(i.href);
        return (
          <Link
            key={i.href}
            href={i.href}
            aria-current={ativo ? "page" : undefined}
            className={cn(
              "relative whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors",
              ativo
                ? "font-medium text-[var(--tinta)] bg-[var(--superficie-sutil)]"
                : "text-[var(--tinta-2)] hover:text-[var(--tinta)] hover:bg-[var(--superficie-sutil)]",
            )}
          >
            {i.rotulo}
          </Link>
        );
      })}
    </nav>
  );
}
