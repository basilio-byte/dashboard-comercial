import "server-only";
import { getEnv, conexaConfigurado } from "@/lib/env";
import { cargaHistorica, sincronizarIncremental } from "./sync-janelas";
import { consolidarTudo } from "@/lib/intel/consolidar";
import { prisma } from "@/lib/db";

/**
 * AGENDADOR EMBUTIDO.
 *
 * Cron externo é um passo que se esquece, e esquecer é silencioso — o dashboard
 * simplesmente para de atualizar e ninguém percebe até alguém estranhar um
 * número velho. Já aconteceu no projeto irmão, que rodou em produção sem cron
 * nenhum configurado. O container já é um processo Node de longa duração; ele
 * mesmo se agenda.
 *
 * ⚠ **Fase ancorada no RELÓGIO DE PAREDE, não no boot.**
 *
 * O irmão usa `setTimeout(atrasoInicial) → setInterval(intervalo)`, o que faz a
 * fase de cada tarefa depender de quando o container subiu — e todo redeploy
 * re-sorteia. Isso torna impossível dizer "sincroniza às :00 e :30", que é o
 * que se precisa para coordenar com outro consumidor da mesma API. Aqui cada
 * tarefa acorda em múltiplos exatos do seu intervalo.
 *
 * ⚠ **Regime declarado: RÉPLICA ÚNICA** (ADR-0003). Com duas réplicas, os dois
 * agendadores competem pelo mesmo teto de requisições. Numa réplica extra,
 * `SYNC_SCHEDULER=off` é obrigatório.
 */

const MINUTO = 60_000;

interface Tarefa {
  nome: string;
  intervaloMs: number;
  ligada: () => boolean;
  executar: () => Promise<unknown>;
}

/** Evita sobreposição: se a anterior não terminou, a vez é pulada e registrada. */
const emExecucao = new Set<string>();

function tarefas(): Tarefa[] {
  const env = getEnv();
  return [
    {
      // Continua a carga histórica enquanto houver janela pendente. É o que faz
      // a primeira carga acontecer sozinha, em vez de exigir dezenas de cliques.
      nome: "carga histórica",
      intervaloMs: 10 * MINUTO,
      ligada: () => env.SYNC_SCHEDULER === "on" && conexaConfigurado(),
      executar: async () => {
        const pendentes = await prisma.syncWindow.count({
          where: { status: { not: "CONCLUIDA" } },
        });
        const fundos = await prisma.syncState.count({ where: { key: { startsWith: "fundo:" } } });
        // Nada pendente E todos os fundos encontrados: a carga terminou.
        if (pendentes === 0 && fundos >= 5) return { pulado: "carga completa" };
        return cargaHistorica({ maxJanelas: 20 });
      },
    },
    {
      nome: "sincronização incremental",
      intervaloMs: 30 * MINUTO,
      ligada: () => env.SYNC_SCHEDULER === "on" && conexaConfigurado(),
      executar: () => sincronizarIncremental(),
    },
    {
      // Roda sobre o espelho local: não consome requisição da API.
      nome: "consolidação da inteligência",
      intervaloMs: 30 * MINUTO,
      ligada: () => env.INTEL_SCHEDULER === "on",
      executar: () => consolidarTudo(),
    },
  ];
}

/** Milissegundos até o próximo múltiplo exato do intervalo, no relógio de parede. */
function ateOProximoSlot(intervaloMs: number): number {
  return intervaloMs - (Date.now() % intervaloMs);
}

let ligado = false;

export function ligarAgendador(): void {
  // `register()` do Next pode ser chamado mais de uma vez em alguns runtimes.
  if (ligado) return;
  ligado = true;

  const env = getEnv();
  const ativas = tarefas().filter((t) => t.ligada());

  if (!ativas.length) {
    console.log(
      `[agendador] nada agendado — SYNC_SCHEDULER=${env.SYNC_SCHEDULER}, ` +
        `INTEL_SCHEDULER=${env.INTEL_SCHEDULER}, conexa=${conexaConfigurado() ? "ok" : "sem token"}`,
    );
    return;
  }

  for (const t of ativas) {
    const disparar = async () => {
      if (emExecucao.has(t.nome)) {
        console.warn(`[agendador] "${t.nome}" ainda rodando — vez pulada`);
        return;
      }
      emExecucao.add(t.nome);
      const t0 = Date.now();
      try {
        const r = await t.executar();
        console.log(`[agendador] "${t.nome}" ok em ${Math.round((Date.now() - t0) / 1000)}s`, r);
      } catch (err) {
        // Falha de uma tarefa NUNCA derruba o agendador: a próxima vez tenta de
        // novo. Um erro transitório da API não pode calar a sincronização.
        console.error(`[agendador] "${t.nome}" FALHOU:`, err instanceof Error ? err.message : err);
      } finally {
        emExecucao.delete(t.nome);
      }
    };

    setTimeout(() => {
      void disparar();
      setInterval(() => void disparar(), t.intervaloMs).unref?.();
    }, ateOProximoSlot(t.intervaloMs)).unref?.();
  }

  console.log(
    `[agendador] ligado: ${ativas
      .map((t) => `${t.nome} a cada ${t.intervaloMs / MINUTO}min`)
      .join(" · ")}`,
  );
}
