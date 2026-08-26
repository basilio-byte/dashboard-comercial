import Link from "next/link";
import { redirect } from "next/navigation";
import { usuarioAtual } from "@/lib/auth/session";
import { sair } from "@/lib/auth/actions";

const NAV = [
  { href: "/", rotulo: "Panorama" },
  { href: "/clientes", rotulo: "Clientes" },
  { href: "/receita", rotulo: "Receita" },
  { href: "/reconciliacao", rotulo: "Reconciliação" },
  { href: "/validacao", rotulo: "Validação" },
  { href: "/operacao", rotulo: "Operação" },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Guarda no LAYOUT, não em cada página: uma página nova nasce protegida por
  // omissão. O contrário — proteger uma a uma — falha silenciosamente na
  // primeira que alguém esquecer.
  const usuario = await usuarioAtual();
  if (!usuario) redirect("/login");

  return (
    <div className="min-h-screen">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
          <span className="font-semibold tracking-tight">Seahub Comercial</span>
          <nav className="flex gap-4 text-sm">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="text-neutral-600 hover:text-neutral-900">
                {n.rotulo}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm text-neutral-500">
            <span>{usuario.name}</span>
            <form action={sair}>
              <button type="submit" className="text-neutral-500 underline hover:text-neutral-900">
                sair
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
