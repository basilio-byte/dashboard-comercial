import { redirect } from "next/navigation";
import { usuarioAtual } from "@/lib/auth/session";
import { sair } from "@/lib/auth/actions";
import { Lateral } from "@/components/Lateral";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Guarda no LAYOUT, não em cada página: página nova nasce protegida por
  // omissão. Proteger uma a uma falha silenciosamente na primeira esquecida.
  const usuario = await usuarioAtual();
  if (!usuario) redirect("/login");

  return (
    <div className="flex min-h-screen">
      {/* Lateral escura fixa: dá identidade própria e libera a largura toda do
          conteúdo para a fila, que é o produto. */}
      <aside className="sticky top-0 hidden h-screen w-[212px] shrink-0 bg-[var(--marca)] md:block">
        <Lateral nome={usuario.name} />
      </aside>

      {/* No celular a lateral vira uma faixa superior compacta. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="bg-[var(--marca)] px-4 py-2 md:hidden">
          <Lateral nome={usuario.name} />
        </div>

        <div className="flex items-center justify-end px-6 pt-4">
          <form action={sair}>
            <button
              type="submit"
              className="rounded-md px-2 py-1 text-[13px] text-[var(--tinta-3)] transition-colors hover:bg-[var(--superficie-sutil)] hover:text-[var(--tinta)]"
            >
              sair
            </button>
          </form>
        </div>

        <main className="mx-auto w-full max-w-5xl flex-1 px-6 pb-14 pt-2">{children}</main>
      </div>
    </div>
  );
}
