"use client";
import { useActionState } from "react";
import { entrar, type EstadoLogin } from "@/lib/auth/actions";

export default function LoginPage() {
  const [estado, acao, pendente] = useActionState<EstadoLogin, FormData>(entrar, {});

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <form action={acao} className="w-full max-w-sm space-y-4">
        <div>
          <h1 className="text-xl font-semibold">Seahub Comercial</h1>
          <p className="mt-1 text-sm text-neutral-500">Acesso restrito ao time interno.</p>
        </div>

        <label className="block">
          <span className="text-sm text-neutral-700">E-mail</span>
          <input
            name="email"
            type="email"
            autoComplete="username"
            required
            className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
          />
        </label>

        <label className="block">
          <span className="text-sm text-neutral-700">Senha</span>
          <input
            name="senha"
            type="password"
            autoComplete="current-password"
            required
            className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
          />
        </label>

        {estado.erro ? (
          <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-800">
            {estado.erro}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pendente}
          className="w-full rounded bg-neutral-900 px-3 py-2 text-white disabled:opacity-60"
        >
          {pendente ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </main>
  );
}
