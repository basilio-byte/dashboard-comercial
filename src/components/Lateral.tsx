"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/ui";

/**
 * Navegação lateral.
 *
 * ⚠ A silhueta e o vocabulário são deliberadamente diferentes do Dashboard
 * Financeiro. Não é gosto: os dois sistemas respondem perguntas diferentes, e
 * uma barra superior com "Panorama · Receita · Reconciliação" fazia este aqui
 * parecer um relatório financeiro — que é justamente o que ele não é.
 *
 * Os nomes vêm do vocabulário comercial, e **Gatilhos** é a palavra do próprio
 * documento de especificação do cliente.
 */
const SECOES = [
  {
    titulo: "Vender",
    itens: [
      { href: "/", rotulo: "Radar", desc: "quem procurar hoje" },
      { href: "/carteira", rotulo: "Carteira", desc: "seus clientes" },
    ],
  },
  {
    titulo: "Ajustar",
    itens: [
      { href: "/gatilhos", rotulo: "Gatilhos", desc: "o que dispara oferta" },
      { href: "/confianca", rotulo: "Confiança", desc: "os números batem?" },
      { href: "/motor", rotulo: "Motor", desc: "carga e integração" },
    ],
  },
];

export function Lateral({ nome }: { nome: string }) {
  const caminho = usePathname();

  return (
    <nav className="flex h-full flex-col gap-7 p-5">
      <Link href="/" className="flex items-baseline gap-2 px-2">
        <span className="text-[17px] font-semibold tracking-tight text-white">Seahub</span>
        <span className="text-[13px] font-light uppercase tracking-[0.18em] text-white/55">
          comercial
        </span>
      </Link>

      <div className="flex flex-1 flex-col gap-6">
        {SECOES.map((s) => (
          <div key={s.titulo}>
            <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">
              {s.titulo}
            </div>
            <ul className="space-y-0.5">
              {s.itens.map((i) => {
                // "/" só marca ativo em correspondência exata, senão marcaria tudo.
                const ativo = i.href === "/" ? caminho === "/" : caminho.startsWith(i.href);
                return (
                  <li key={i.href}>
                    <Link
                      href={i.href}
                      aria-current={ativo ? "page" : undefined}
                      className={cn(
                        "block rounded-lg px-2.5 py-2 transition-colors",
                        ativo ? "bg-white/12" : "hover:bg-white/[0.07]",
                      )}
                    >
                      <div
                        className={cn(
                          "text-[14px] leading-tight",
                          ativo ? "font-semibold text-white" : "font-medium text-white/85",
                        )}
                      >
                        {i.rotulo}
                      </div>
                      <div className="text-[11px] leading-tight text-white/45">{i.desc}</div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <Link
        href="/minha-conta"
        className="rounded-lg px-2.5 py-2 transition-colors hover:bg-white/[0.07]"
      >
        <div className="text-[11px] uppercase tracking-wider text-white/40">Conta</div>
        <div className="truncate text-[13px] text-white/85">{nome}</div>
      </Link>
    </nav>
  );
}
