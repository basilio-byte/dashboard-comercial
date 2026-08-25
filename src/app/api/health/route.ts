import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getEnv, conexaConfigurado } from "@/lib/env";

// Nunca cachear: o Easypanel usa esta rota como healthcheck, e uma resposta
// cacheada diria "ok" com o banco fora do ar.
export const dynamic = "force-dynamic";

export async function GET() {
  // Valida as variáveis de ambiente a cada chamada (barato: o resultado é
  // memoizado). Se o deploy subiu sem SESSION_SECRET ou DATABASE_URL, o
  // healthcheck é o primeiro a dizer — e diz o nome do que falta.
  let env: ReturnType<typeof getEnv> | null = null;
  let erroEnv: string | null = null;
  try {
    env = getEnv();
  } catch (err) {
    erroEnv = err instanceof Error ? err.message : String(err);
  }

  let db: "ok" | "erro" = "erro";
  if (env) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      db = "ok";
    } catch {
      db = "erro";
    }
  }

  const saudavel = Boolean(env) && db === "ok";

  return NextResponse.json(
    {
      status: saudavel ? "ok" : "degradado",
      db,
      env: env ? "ok" : "erro",
      ...(erroEnv ? { erroEnv } : {}),
      ...(env
        ? {
            timezone: env.APP_TIMEZONE,
            conexa: conexaConfigurado() ? "configurado" : "sem token",
            // Espelha os interruptores para dar pra conferir, de fora, se o
            // deploy subiu com o disparo fechado (ADR-0004).
            notificador: env.NOTIFICADOR,
            modo: env.NOTIFICADOR_MODO,
          }
        : {}),
    },
    { status: saudavel ? 200 : 503 },
  );
}
