"use client";
import { useActionState } from "react";
import { entrar, type EstadoLogin } from "@/lib/auth/actions";

export default function LoginPage() {
  const [estado, acao, pendente] = useActionState<EstadoLogin, FormData>(entrar, {});

  return (
    <main className="flex min-h-screen">
      {/* Painel de marca: mesma cor da lateral, para o login já apresentar a
          identidade do sistema em vez de um formulário solto no branco. */}
      <div className="hidden flex-1 flex-col justify-between bg-[var(--marca)] p-10 lg:flex">
        <div className="flex items-baseline gap-2">
          <span className="text-[19px] font-semibold tracking-tight text-white">Seahub</span>
          <span className="text-[13px] font-light uppercase tracking-[0.18em] text-white/55">
            comercial
          </span>
        </div>
        <div className="max-w-sm">
          <p className="text-[26px] font-semibold leading-snug tracking-tight text-white">
            Quem procurar hoje, e por quê.
          </p>
          <p className="mt-3 text-[14px] leading-relaxed text-white/60">
            O sistema cruza contrato, faturamento, reserva e pacote de horas para achar potencial de
            venda adicional — e entrega o sinal ao vendedor responsável.
          </p>
        </div>
        <p className="text-[12px] text-white/40">
          Uso interno. Nenhuma mensagem sai para o cliente final.
        </p>
      </div>

      <div className="flex flex-1 items-center justify-center px-6">
        <form action={acao} className="w-full max-w-[320px] space-y-4">
          <div className="lg:hidden">
            <span className="text-[19px] font-semibold tracking-tight">Seahub</span>{" "}
            <span className="text-[13px] font-light uppercase tracking-[0.18em] text-[var(--tinta-3)]">
              comercial
            </span>
          </div>

          <div>
            <h1 className="text-[20px] font-semibold tracking-tight">Entrar</h1>
            <p className="mt-1 text-[13px] text-[var(--tinta-2)]">Acesso restrito ao time interno.</p>
          </div>

          <label className="block">
            <span className="text-[13px] text-[var(--tinta-2)]">E-mail</span>
            <input
              name="email"
              type="email"
              autoComplete="username"
              required
              className="mt-1 w-full rounded-lg border border-[var(--linha)] bg-[var(--superficie)] px-3 py-2 text-sm outline-none focus:border-[var(--serie-1)]"
            />
          </label>

          <label className="block">
            <span className="text-[13px] text-[var(--tinta-2)]">Senha</span>
            <input
              name="senha"
              type="password"
              autoComplete="current-password"
              required
              className="mt-1 w-full rounded-lg border border-[var(--linha)] bg-[var(--superficie)] px-3 py-2 text-sm outline-none focus:border-[var(--serie-1)]"
            />
          </label>

          {estado.erro ? (
            <p role="alert" className="faixa faixa-critico">
              {estado.erro}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={pendente}
            className="w-full rounded-lg bg-[var(--marca)] px-3 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {pendente ? "Entrando…" : "Entrar"}
          </button>
        </form>
      </div>
    </main>
  );
}
