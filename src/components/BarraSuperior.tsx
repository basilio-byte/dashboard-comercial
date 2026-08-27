import Link from "next/link";
import { prisma } from "@/lib/db";
import { horaLocal } from "@/lib/dates";
import { MenuMovel } from "./MenuMovel";
import { Logo } from "./Logo";
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
  /**
   * ⚠ Filtra por MODO. Sem isso o selo mentia: `consolidarTudo()` abre um run
   * `intelligence` a cada 30 minutos, fecha SUCCESS — e **não fala com o
   * Conexa**, só recalcula sobre o espelho local. O selo dizia "sincronizado
   * 17:16" com a última leitura real do ERP horas atrás.
   *
   * É a pior classe de mentira que uma tela de dado pode contar: ela responde
   * exatamente a pergunta "posso confiar no que estou vendo?" — e respondia sim
   * olhando para o relógio errado.
   *
   * `HALTED` conta: é o fim NORMAL de uma carga que gastou o orçamento de tempo
   * depois de gravar dado. Exigir SUCCESS descartaria justamente o caso comum do
   * agendador.
   */
  const ultimo = await prisma.syncRun.findFirst({
    where: {
      mode: { in: ["dimensions", "backfill", "incremental", "revisita"] },
      status: { in: ["SUCCESS", "HALTED"] },
      finishedAt: { not: null },
    },
    orderBy: { finishedAt: "desc" },
    select: { finishedAt: true },
  });

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-[var(--borda)] bg-[color-mix(in_oklab,var(--plano)_86%,transparent)] px-4 backdrop-blur-md sm:px-6">
      <MenuMovel nome={nome} email={email} />

      {/* No celular não há lateral visível: a marca precisa aparecer aqui — e
          sobre superfície clara, então o logotipo branco inverte. */}
      <Link href="/" aria-label="Seahub Comercial" className="md:hidden">
        <Logo altura={19} tom="tinta" />
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
  const hora = horaLocal(em);

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
