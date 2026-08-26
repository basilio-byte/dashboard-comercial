"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Radar, Users, Zap, ShieldCheck, Cog, LogOut, type LucideIcon } from "lucide-react";
import { sair } from "@/lib/auth/actions";
import { cn, iniciais } from "@/lib/ui";

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
 *
 * As descrições de cada item saíram daqui e viraram o subtítulo da própria
 * página: repetidas na lateral, empurravam cada item para duas linhas e a
 * navegação virava um parágrafo. O ícone faz esse trabalho em uma linha.
 */

export interface ItemNav {
  href: string;
  rotulo: string;
  Icone: LucideIcon;
}

export const SECOES: { titulo: string; itens: ItemNav[] }[] = [
  {
    titulo: "Vender",
    itens: [
      { href: "/", rotulo: "Radar", Icone: Radar },
      { href: "/carteira", rotulo: "Carteira", Icone: Users },
    ],
  },
  {
    titulo: "Ajustar",
    itens: [
      { href: "/gatilhos", rotulo: "Gatilhos", Icone: Zap },
      { href: "/confianca", rotulo: "Confiança", Icone: ShieldCheck },
      { href: "/motor", rotulo: "Motor", Icone: Cog },
    ],
  },
];

/** "/" só marca ativo em correspondência exata, senão marcaria tudo. */
export function estaAtivo(href: string, caminho: string): boolean {
  return href === "/" ? caminho === "/" : caminho.startsWith(href);
}

export function Lateral({
  nome,
  email,
  aoNavegar,
}: {
  nome: string;
  email?: string;
  /** Fecha a gaveta no celular. No desktop não existe gaveta, então é opcional. */
  aoNavegar?: () => void;
}) {
  const caminho = usePathname();

  return (
    <nav className="flex h-full flex-col bg-marca">
      <Link
        href="/"
        onClick={aoNavegar}
        className="flex items-center gap-2.5 px-5 py-5 transition-opacity hover:opacity-90"
      >
        <Marca />
        <span className="flex flex-col leading-none">
          <span className="text-[15px] font-semibold tracking-tight text-[var(--marca-tinta)]">
            Seahub
          </span>
          <span className="mt-1 text-[9.5px] font-medium uppercase tracking-[0.2em] text-[var(--marca-tinta-3)]">
            comercial
          </span>
        </span>
      </Link>

      <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-3 pb-4">
        {SECOES.map((s) => (
          <div key={s.titulo}>
            <div className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--marca-tinta-3)]">
              {s.titulo}
            </div>
            <ul className="space-y-px">
              {s.itens.map(({ href, rotulo, Icone }) => {
                const ativo = estaAtivo(href, caminho);
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      onClick={aoNavegar}
                      aria-current={ativo ? "page" : undefined}
                      className={cn(
                        "relative flex h-9 items-center gap-2.5 rounded-[7px] px-2.5 text-[13.5px] transition-colors",
                        ativo
                          ? "bg-[var(--marca-ativo)] font-semibold text-[var(--marca-tinta)]"
                          : "font-medium text-[var(--marca-tinta-2)] hover:bg-[var(--marca-hover)] hover:text-[var(--marca-tinta)]",
                      )}
                    >
                      {/* A aresta é o que diz "aqui" à distância — o fundo
                          sozinho, com 12% de branco, some numa olhada rápida. */}
                      {ativo ? (
                        <span
                          aria-hidden
                          className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-[var(--acento)]"
                        />
                      ) : null}
                      <Icone size={16} strokeWidth={ativo ? 2.25 : 2} className="shrink-0" />
                      {rotulo}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <Rodape nome={nome} email={email} aoNavegar={aoNavegar} caminho={caminho} />
    </nav>
  );
}

/** Marca gráfica: as duas ondas do nome, reduzidas a um sinal. */
function Marca() {
  return (
    <span
      aria-hidden
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-[var(--acento)] shadow-[inset_0_1px_0_rgba(255,255,255,.25)]"
    >
      <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden>
        <path
          d="M3 12.5c1.6-2 3.2-2 4.8 0s3.2 2 4.8 0 3.2-2 4.4-.4"
          stroke="#fff"
          strokeWidth="1.9"
          strokeLinecap="round"
        />
        <path
          d="M3 7.5c1.6-2 3.2-2 4.8 0s3.2 2 4.8 0 3.2-2 4.4-.4"
          stroke="#fff"
          strokeOpacity=".55"
          strokeWidth="1.9"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

/**
 * Conta e saída.
 *
 * O "sair" morava solto no canto superior direito do conteúdo, sem nada por
 * perto — a única coisa naquela faixa inteira. Aqui ele fica onde se procura
 * por ele, ao lado de quem está logado.
 */
function Rodape({
  nome,
  email,
  aoNavegar,
  caminho,
}: {
  nome: string;
  email?: string;
  aoNavegar?: () => void;
  caminho: string;
}) {
  return (
    <div className="border-t border-[var(--marca-borda)] p-3">
      <div className="flex items-center gap-1">
        <Link
          href="/minha-conta"
          onClick={aoNavegar}
          aria-current={estaAtivo("/minha-conta", caminho) ? "page" : undefined}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2.5 rounded-[7px] px-2 py-1.5 transition-colors",
            estaAtivo("/minha-conta", caminho)
              ? "bg-[var(--marca-ativo)]"
              : "hover:bg-[var(--marca-hover)]",
          )}
        >
          <span
            aria-hidden
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--marca-ativo)] text-[10.5px] font-semibold text-[var(--marca-tinta)]"
          >
            {iniciais(nome)}
          </span>
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-[12.5px] font-medium text-[var(--marca-tinta)]">
              {nome}
            </span>
            {email ? (
              <span className="block truncate text-[10.5px] text-[var(--marca-tinta-3)]">
                {email}
              </span>
            ) : null}
          </span>
        </Link>

        {/* Formulário, não link: sair muda estado no servidor. */}
        <form action={sair}>
          <button
            type="submit"
            title="Sair"
            aria-label="Sair"
            className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--marca-tinta-3)] transition-colors hover:bg-[var(--marca-hover)] hover:text-[var(--marca-tinta)]"
          >
            <LogOut size={15} />
          </button>
        </form>
      </div>
    </div>
  );
}
