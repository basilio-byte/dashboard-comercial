"use client";
import { useActionState } from "react";
import { CircleAlert, Radar, Zap, ShieldCheck } from "lucide-react";
import { entrar, type EstadoLogin } from "@/lib/auth/actions";
import { Assinatura } from "@/components/Logo";

export default function LoginPage() {
  const [estado, acao, pendente] = useActionState<EstadoLogin, FormData>(entrar, {});

  return (
    <main className="flex min-h-screen">
      {/* Painel de marca: o login já apresenta a identidade do sistema em vez
          de um formulário solto no branco. */}
      <div className="relative hidden flex-1 flex-col justify-between overflow-hidden bg-marca p-12 lg:flex">
        {/* Brilho de fundo: dá volume ao painel sem virar decoração barulhenta. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full opacity-[0.22] blur-3xl"
          style={{ background: "var(--acento)" }}
        />

        <div className="relative">
          <Assinatura altura={32} />
        </div>

        <div className="relative max-w-md">
          <h2 className="text-[30px] font-semibold leading-[1.2] tracking-[-0.025em] text-[var(--marca-tinta)]">
            Quem procurar hoje,
            <br />e por quê.
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-[var(--marca-tinta-2)]">
            O sistema cruza contrato, faturamento, reserva e pacote de horas para achar potencial de
            venda adicional — e entrega o sinal ao vendedor responsável.
          </p>

          <ul className="mt-8 space-y-3">
            <Ponto Icone={Radar} texto="A fila de oportunidades, ordenada pelo sinal mais forte" />
            <Ponto Icone={Zap} texto="Gatilhos explícitos: o que dispara oferta e o que não dispara" />
            <Ponto Icone={ShieldCheck} texto="Todo número com procedência declarada" />
          </ul>
        </div>

        <p className="relative text-[13px] text-[var(--marca-tinta-3)]">
          Uso interno. Nenhuma mensagem sai para o cliente final.
        </p>
      </div>

      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <form action={acao} className="w-full max-w-[340px]">
          <div className="mb-7 lg:hidden">
            <Assinatura altura={24} tom="tinta" />
          </div>

          <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Entrar</h1>
          <p className="mt-1.5 text-[14px] text-[var(--tinta-2)]">Acesso restrito ao time interno.</p>

          <div className="mt-6 space-y-3.5">
            <Campo nome="email" rotulo="E-mail" tipo="email" autoComplete="username" />
            <Campo nome="senha" rotulo="Senha" tipo="password" autoComplete="current-password" />

            {estado.erro ? (
              <div role="alert" className="faixa faixa-critico">
                <CircleAlert size={16} className="faixa-icone" aria-hidden />
                <div className="min-w-0 flex-1">{estado.erro}</div>
              </div>
            ) : null}

            <button type="submit" disabled={pendente} className="btn btn-primario w-full !py-2.5">
              {pendente ? "Entrando…" : "Entrar"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}

function Ponto({ Icone, texto }: { Icone: typeof Radar; texto: string }) {
  return (
    <li className="flex items-start gap-2.5 text-[14px] leading-relaxed text-[var(--marca-tinta-2)]">
      <Icone size={15} className="mt-0.5 shrink-0 text-[var(--acento)]" aria-hidden />
      {texto}
    </li>
  );
}

function Campo({
  nome,
  rotulo,
  tipo,
  autoComplete,
}: {
  nome: string;
  rotulo: string;
  tipo: string;
  autoComplete: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[13.5px] font-medium text-[var(--tinta-2)]">{rotulo}</span>
      <input
        name={nome}
        type={tipo}
        autoComplete={autoComplete}
        required
        className="campo !py-2.5 !text-[15px]"
      />
    </label>
  );
}
