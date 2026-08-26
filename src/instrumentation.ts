/**
 * Ponto de entrada do Next executado UMA vez quando o processo do servidor
 * sobe — inclusive no build standalone usado no Docker, e nunca durante
 * `next build`.
 *
 * É aqui que o agendador embutido liga. Ver src/lib/conexa/agendador.ts.
 */
export async function register() {
  // Só no runtime Node. O edge runtime não tem timers de longa duração nem
  // acesso ao banco, e tentar ligar o agendador lá quebraria o build.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { ligarAgendador } = await import("@/lib/conexa/agendador");
  const { enterrarZumbis } = await import("@/lib/conexa/sync");

  // Enterra execuções que ficaram RUNNING porque o processo morreu (o Easypanel
  // mata o container em todo redeploy). Sem isto elas ficam abertas para sempre
  // e a tela de operação mostra um sync eternamente "em andamento".
  try {
    const n = await enterrarZumbis();
    if (n > 0) console.log(`[boot] ${n} execução(ões) zumbi encerrada(s)`);
  } catch (err) {
    console.error("[boot] falha ao enterrar zumbis:", err instanceof Error ? err.message : err);
  }

  ligarAgendador();
}
