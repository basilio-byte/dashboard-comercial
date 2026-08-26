import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/env";
import { syncDimensoes } from "@/lib/conexa/sync";
import { cargaHistorica, sincronizarIncremental } from "@/lib/conexa/sync-janelas";
import type { Entidade } from "@/lib/conexa/janelas";
import { consolidarTudo } from "@/lib/intel/consolidar";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Porta HTTP do sync — para cron externo e para disparo manual.
 *
 * Exige `x-cron-secret`. Sem segredo configurado, a rota fica FECHADA (503) em
 * vez de aberta: um deploy que esqueceu a variável não pode virar um endpoint
 * público que consome o rate limit compartilhado.
 */
export async function POST(req: NextRequest) {
  const env = getEnv();
  if (!env.CRON_SECRET) {
    return NextResponse.json(
      { erro: "CRON_SECRET não configurado — rota desabilitada por segurança." },
      { status: 503 },
    );
  }
  if (req.headers.get("x-cron-secret") !== env.CRON_SECRET) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }

  const params = new URL(req.url).searchParams;
  // O default é o incremental: `POST /api/sync` sem query string é o uso óbvio
  // de um cron, e agora ele faz a coisa certa. (Antes o default era "reconcile",
  // que não tinha implementação e devolvia 400.)
  const modo = params.get("mode") ?? "incremental";
  // `entity=bookings,contracts` restringe a carga — permite priorizar quando o
  // ritmo é conservador e a fila inteira levaria horas.
  const entidades = params.get("entity")?.split(",").map((s) => s.trim()).filter(Boolean);
  try {
    switch (modo) {
      case "dimensions":
        return NextResponse.json(await syncDimensoes());
      case "incremental":
        return NextResponse.json(
          await sincronizarIncremental({ entidades: entidades as Entidade[] | undefined }),
        );
      case "backfill": {
        // `minutes` é o freio preferido: gasta o orçamento de requisições em vez
        // de contar janelas, que custam de 1 a 5 requisições cada. Teto de 4,5
        // min para caber em `maxDuration` (5 min) com margem para a resposta.
        // `windows` segue aceito para chamada pontual.
        const minutos = params.get("minutes");
        const janelas = params.get("windows");
        return NextResponse.json(
          await cargaHistorica({
            entidades: entidades as Entidade[] | undefined,
            orcamentoMs: minutos
              ? Math.min(Number(minutos), 4.5) * 60_000
              : janelas
                ? undefined
                : 4.5 * 60_000,
            maxJanelas: janelas ? Number(janelas) : undefined,
          }),
        );
      }
      case "intelligence":
        return NextResponse.json(await consolidarTudo());
      default:
        return NextResponse.json({ erro: `modo desconhecido: ${modo}` }, { status: 400 });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ erro: msg }, { status: 500 });
  }
}
