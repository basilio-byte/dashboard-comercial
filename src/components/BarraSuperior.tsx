import Link from "next/link";
import { prisma } from "@/lib/db";
import { MenuMovel } from "./MenuMovel";
import { cn } from "@/lib/ui";

/**
 * Barra superior.
 *
 * Carrega **a frescura do espelho**, e não um título repetido: a pergunta
 * "posso confiar no que estou vendo agora?" vale em todas as telas, não só no
 * Radar — onde essa informação estava presa antes. Uma tela de oportunidades
 * sobre dado de ontem manda o vendedor ligar para o cliente errado.
 */
export async function BarraSuperior({ nome, email }: { nome: string; email?: string }) {
  const ultimo = await prisma.syncRun.findFirst({
    where: { status: "SUCCESS" },
    orderBy: { finishedAt: "desc" },
    select: { finishedAt: true },
  });

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-[var(--borda)] bg-[color-mix(in_oklab,var(--plano)_86%,transparent)] px-4 backdrop-blur-md sm:px-6">
      <MenuMovel nome={nome} email={email} />

      {/* No celular não há lateral visível: a marca precisa aparecer aqui. */}
      <Link href="/" className="flex items-baseline gap-1.5 md:hidden">
        <span className="text-[14px] font-semibold tracking-tight">Seahub</span>
        <span className="text-[9.5px] font-medium uppercase tracking-[0.18em] text-[var(--tinta-3)]">
          comercial
        </span>
      </Link>

      <div className="ml-auto">
        <SeloSincronizacao em={ultimo?.finishedAt ?? null} />
      </div>
    </header>
  );
}

/**
 * Frescura do espelho, em três estados.
 *
 * ⚠ O ponto colorido nunca vai sozinho: vem sempre com o texto ao lado. Cor
 * como único portador de significado quebra para quem não a distingue.
 */
function SeloSincronizacao({ em }: { em: Date | null }) {
  if (em === null) {
    return (
      <Link href="/motor" className="selo selo-atencao hover:opacity-85">
        <Ponto classe="bg-[var(--atencao)]" />
        nunca sincronizado
      </Link>
    );
  }

  const horas = (Date.now() - em.getTime()) / 3_600_000;
  const velho = horas > 2;
  const hora = new Intl.DateTimeFormat("pt-BR", { timeStyle: "short" }).format(em);

  return (
    <Link
      href="/motor"
      title={`Última carga bem-sucedida às ${hora}`}
      className={cn("selo hover:opacity-85", velho && "selo-atencao")}
    >
      <Ponto classe={velho ? "bg-[var(--atencao)]" : "bg-[var(--bom)]"} />
      {velho ? `dado de ${horas.toFixed(0)}h atrás` : `sincronizado ${hora}`}
    </Link>
  );
}

function Ponto({ classe }: { classe: string }) {
  return <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full", classe)} />;
}
