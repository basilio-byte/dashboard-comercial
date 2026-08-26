import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/env";
import { syncBackfill, syncDimensoes } from "@/lib/conexa/sync";
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
  const modo = params.get("mode") ?? "reconcile";
  // `entity=bookings,contracts` restringe a carga — permite priorizar quando o
  // ritmo é conservador e a fila inteira levaria horas.
  const entidades = params.get("entity")?.split(",").map((s) => s.trim()).filter(Boolean);
  try {
    switch (modo) {
      case "dimensions":
        return NextResponse.json(await syncDimensoes());
      case "backfill":
        return NextResponse.json(await syncBackfill({ maxPaginasPorEntidade: 50, entidades }));
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
