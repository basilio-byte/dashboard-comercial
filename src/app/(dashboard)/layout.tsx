import { redirect } from "next/navigation";
import { usuarioAtual } from "@/lib/auth/session";
import { Lateral } from "@/components/Lateral";
import { BarraSuperior } from "@/components/BarraSuperior";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Guarda no LAYOUT, não em cada página: página nova nasce protegida por
  // omissão. Proteger uma a uma falha silenciosamente na primeira esquecida.
  const usuario = await usuarioAtual();
  if (!usuario) redirect("/login");

  return (
    <div className="flex min-h-screen">
      {/* Lateral fixa: dá identidade própria e libera a largura toda do
          conteúdo para a fila, que é o produto. No celular ela some e vira a
          gaveta da barra superior. */}
      <aside className="sticky top-0 hidden h-screen w-[236px] shrink-0 border-r border-[var(--marca-borda)] md:block">
        <Lateral nome={usuario.name} email={usuario.email} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <BarraSuperior nome={usuario.name} email={usuario.email} />
        <main className="mx-auto w-full max-w-[1180px] flex-1 px-4 pb-20 pt-7 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
