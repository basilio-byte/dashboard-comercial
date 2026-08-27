"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader, CircleCheck, CirclePause } from "lucide-react";
import { cn } from "@/lib/ui";

/**
 * PULSO DA CARGA — "está trabalhando agora?".
 *
 * ⚠ A tela Motor é `force-dynamic`, mas HTML estático: sem recarregar, os
 * números ficam iguais para sempre. Foi por isso que a carga rodando pareceu
 * parada. Aqui o componente recarrega a rota sozinho enquanto houver janela
 * pendente, e o cronômetro corre no cliente para o pulso ser visível ENTRE
 * duas recargas — sem ele, a tela ainda pareceria congelada por 15s de cada vez.
 *
 * Para de recarregar quando não há mais pendência: uma tela pronta não precisa
 * ficar batendo no banco.
 */
export function Pulso({
  ultimaEscritaISO,
  janelaEmAndamento,
  pendentes,
  intervaloMs = 15_000,
}: {
  ultimaEscritaISO: string | null;
  janelaEmAndamento: { entidade: string; janela: string } | null;
  pendentes: number;
  intervaloMs?: number;
}) {
  const router = useRouter();
  /**
   * ⚠ Começa NULO, não em `Date.now()`.
   *
   * Componente de cliente também é renderizado no servidor para o HTML
   * inicial. Semeando com `Date.now()`, o servidor escrevia "há 12s" e o
   * cliente hidratava com "há 13s" — texto diferente, e o React derrubava a
   * hidratação com o erro #418, visto no console da produção em 2026-08-27.
   *
   * Com `null`, servidor e cliente concordam no primeiro render (o selo não
   * mostra o contador), e o relógio começa a andar depois de montar.
   */
  const [agora, setAgora] = useState<number | null>(null);

  // Cronômetro local: 1s. Não bate no servidor, só faz o número andar.
  useEffect(() => {
    setAgora(Date.now());
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Recarrega os dados do servidor enquanto houver o que carregar.
  useEffect(() => {
    if (pendentes === 0) return;
    const t = setInterval(() => router.refresh(), intervaloMs);
    return () => clearInterval(t);
  }, [pendentes, intervaloMs, router]);

  if (!ultimaEscritaISO) {
    return (
      <span className="selo">
        <CirclePause size={12} aria-hidden />
        nenhuma janela iniciada
      </span>
    );
  }

  // Antes de montar não há relógio de cliente: mostra o estado sem o contador,
  // igual no servidor e no navegador.
  if (agora === null) {
    return (
      <span className="selo">
        {pendentes === 0 ? "carga completa" : "verificando…"}
      </span>
    );
  }

  const segundos = Math.max(0, Math.round((agora - Date.parse(ultimaEscritaISO)) / 1000));
  // Duas batidas do ciclo de escrita já seriam muito: uma janela grande grava a
  // cada página, e o limitador espaça as requisições em ~2s.
  const vivo = segundos < 90;
  const concluido = pendentes === 0;

  if (concluido) {
    return (
      <span className="selo selo-bom">
        <CircleCheck size={12} aria-hidden />
        carga completa
      </span>
    );
  }

  return (
    <span className={cn("selo", vivo ? "selo-info" : "selo-atencao")} title={ultimaEscritaISO}>
      {vivo ? (
        <Loader size={12} className="animate-spin" aria-hidden />
      ) : (
        <CirclePause size={12} aria-hidden />
      )}
      {vivo ? "carregando" : "parado"} · última escrita há {formatar(segundos)}
      {vivo && janelaEmAndamento ? (
        <span className="font-normal opacity-70">
          {" "}
          · {janelaEmAndamento.entidade} {janelaEmAndamento.janela}
        </span>
      ) : null}
    </span>
  );
}

function formatar(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}
