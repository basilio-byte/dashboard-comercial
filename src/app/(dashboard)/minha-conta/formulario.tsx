"use client";
import { useActionState } from "react";
import { trocarSenha, type EstadoSenha } from "@/lib/auth/senha-actions";

export function FormularioSenha() {
  const [estado, acao, pendente] = useActionState<EstadoSenha, FormData>(trocarSenha, {});

  return (
    <form action={acao} className="space-y-3">
      <Campo nome="atual" rotulo="Senha atual" autoComplete="current-password" />
      <Campo nome="nova" rotulo="Nova senha" autoComplete="new-password" />
      <Campo nome="confirmacao" rotulo="Repita a nova senha" autoComplete="new-password" />

      {estado.erro ? (
        <p role="alert" className="faixa faixa-critico">
          {estado.erro}
        </p>
      ) : null}
      {estado.ok ? (
        <p role="status" className="faixa faixa-bom">
          {estado.ok}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pendente}
        className="w-full rounded-lg bg-[var(--marca)] px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pendente ? "Trocando…" : "Trocar senha"}
      </button>
    </form>
  );
}

function Campo({
  nome,
  rotulo,
  autoComplete,
}: {
  nome: string;
  rotulo: string;
  autoComplete: string;
}) {
  return (
    <label className="block">
      <span className="text-[13px] text-[var(--tinta-2)]">{rotulo}</span>
      <input
        name={nome}
        type="password"
        autoComplete={autoComplete}
        required
        className="mt-1 w-full rounded-lg border border-[var(--linha)] bg-[var(--superficie)] px-3 py-2 text-sm outline-none focus:border-[var(--serie-1)]"
      />
    </label>
  );
}
