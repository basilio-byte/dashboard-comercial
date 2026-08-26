"use client";
import { useActionState } from "react";
import { CircleAlert, CircleCheck } from "lucide-react";
import { trocarSenha, type EstadoSenha } from "@/lib/auth/senha-actions";

export function FormularioSenha() {
  const [estado, acao, pendente] = useActionState<EstadoSenha, FormData>(trocarSenha, {});

  return (
    <form action={acao} className="space-y-3.5">
      <Campo nome="atual" rotulo="Senha atual" autoComplete="current-password" />
      <Campo nome="nova" rotulo="Nova senha" autoComplete="new-password" />
      <Campo nome="confirmacao" rotulo="Repita a nova senha" autoComplete="new-password" />

      {estado.erro ? (
        <div role="alert" className="faixa faixa-critico">
          <CircleAlert size={16} className="faixa-icone" aria-hidden />
          <div className="min-w-0 flex-1">{estado.erro}</div>
        </div>
      ) : null}
      {estado.ok ? (
        <div role="status" className="faixa faixa-bom">
          <CircleCheck size={16} className="faixa-icone" aria-hidden />
          <div className="min-w-0 flex-1">{estado.ok}</div>
        </div>
      ) : null}

      <button type="submit" disabled={pendente} className="btn btn-primario w-full !py-2.5">
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
      <span className="mb-1 block text-[13.5px] font-medium text-[var(--tinta-2)]">{rotulo}</span>
      <input
        name={nome}
        type="password"
        autoComplete={autoComplete}
        required
        className="campo !py-2.5 !text-[15px]"
      />
    </label>
  );
}
