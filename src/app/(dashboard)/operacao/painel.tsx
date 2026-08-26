"use client";
import { useState, useTransition } from "react";
import {
  acaoBackfill,
  acaoConsolidar,
  acaoIncremental,
  acaoSincronizarCadastros,
} from "@/lib/operacao/actions";

export function PainelOperacao() {
  const [pendente, iniciar] = useTransition();
  const [saida, setSaida] = useState<string | null>(null);

  const rodar = (fn: () => Promise<unknown>, rotulo: string) => () => {
    setSaida(`${rotulo}: em andamento…`);
    iniciar(async () => {
      try {
        const r = await fn();
        setSaida(`${rotulo}: ${JSON.stringify(r)}`);
      } catch (err) {
        setSaida(`${rotulo}: ERRO — ${err instanceof Error ? err.message : String(err)}`);
      }
    });
  };

  return (
    <section className="rounded border border-neutral-200 bg-white px-4 py-3">
      <h2 className="text-sm font-medium">Ações</h2>
      <p className="mt-1 text-xs text-neutral-500">
        Na ordem: cadastros primeiro (tudo depende deles), depois a carga, depois a consolidação.
        A carga é feita <strong>por janela mensal</strong>, da mais recente para a mais antiga, com
        teto por execução — rodar de novo continua de onde parou. O incremental reprocessa só as
        janelas recentes e é o que um cron deve chamar.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Botao onClick={rodar(acaoSincronizarCadastros, "Cadastros")} disabled={pendente}>
          1 · Sincronizar cadastros
        </Botao>
        <Botao onClick={rodar(acaoBackfill, "Carga")} disabled={pendente}>
          2 · Carregar dados (retomável)
        </Botao>
        <Botao onClick={rodar(acaoConsolidar, "Consolidação")} disabled={pendente}>
          3 · Consolidar inteligência
        </Botao>
        <Botao onClick={rodar(acaoIncremental, "Incremental")} disabled={pendente}>
          Atualizar (incremental)
        </Botao>
      </div>
      {saida ? (
        <pre className="mt-3 overflow-x-auto rounded bg-neutral-50 p-3 text-xs text-neutral-700">{saida}</pre>
      ) : null}
    </section>
  );
}

function Botao({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-50"
    >
      {children}
    </button>
  );
}
