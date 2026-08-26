"use client";
import { useState, useTransition } from "react";
import { acaoReconciliar } from "@/lib/operacao/actions";
import type { ResultadoReconciliacao } from "@/lib/intel/reconciliar";
import { rotuloMes } from "@/lib/dates";

export function PainelReconciliacao({ meses }: { meses: string[] }) {
  const [pendente, iniciar] = useTransition();
  const [r, setR] = useState<ResultadoReconciliacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [mes, setMes] = useState(meses[0] ?? "");

  const rodar = () => {
    setErro(null);
    setR(null);
    iniciar(async () => {
      try {
        setR(await acaoReconciliar(mes));
      } catch (e) {
        setErro(e instanceof Error ? e.message : String(e));
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="block text-[var(--tinta-2)]">Mês fechado</span>
          <select
            value={mes}
            onChange={(e) => setMes(e.target.value)}
            className="mt-1 rounded border border-[var(--linha)] px-3 py-1.5 text-sm"
          >
            {meses.map((m) => (
              <option key={m} value={m}>
                {rotuloMes(m)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={rodar}
          disabled={pendente || !mes}
          className="rounded border border-[var(--linha)] px-3 py-1.5 text-sm hover:bg-[var(--superficie-sutil)] disabled:opacity-50"
        >
          {pendente ? "Conferindo… (pode levar minutos)" : "Conferir contra o Conexa"}
        </button>
      </div>

      {erro ? <p className="rounded faixa faixa-critico">{erro}</p> : null}

      {r ? (
        <div
          className={`rounded border px-4 py-3 ${
            r.veredicto === "BATE"
              ? "faixa-bom"
              : r.veredicto === "DIVERGE"
                ? "border-[color-mix(in_oklab,var(--critico)_35%,transparent)] bg-[var(--wash-critico)]"
                : "border-[color-mix(in_oklab,var(--atencao)_35%,transparent)] bg-[var(--wash-atencao)]"
          }`}
        >
          <p className="font-medium">
            {r.veredicto === "BATE"
              ? `✓ ${rotuloMes(r.mesKey)} bate`
              : r.veredicto === "DIVERGE"
                ? `✗ ${rotuloMes(r.mesKey)} DIVERGE`
                : `⚠ ${rotuloMes(r.mesKey)} — nada conferido`}
          </p>
          {r.observacao ? <p className="mt-1 text-sm">{r.observacao}</p> : null}
          <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
            <Par t="Local" v={`R$ ${r.localTotal}`} sub={`${r.localContagem} cobranças`} />
            <Par t="Conexa" v={`R$ ${r.remotoTotal}`} sub={`${r.remotoContagem} cobranças`} />
            <Par t="Diferença" v={`R$ ${r.diferenca}`} />
            <Par t="Requisições" v={String(r.requisicoes)} />
          </dl>

          {r.divergencias.length ? (
            <div className="mt-3">
              <p className="text-sm font-medium">Divergências (até 50)</p>
              <ul className="mt-1 space-y-0.5 text-xs text-[var(--tinta-2)]">
                {r.divergencias.map((d) => (
                  <li key={`${d.chargeId}-${d.motivo}`}>
                    cobrança <strong>{d.chargeId}</strong> — {d.motivo}
                    {d.local ? ` · local R$ ${d.local}` : ""}
                    {d.remoto ? ` · Conexa R$ ${d.remoto}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Par({ t, v, sub }: { t: string; v: string; sub?: string }) {
  return (
    <div>
      <dt className="text-xs text-[var(--tinta-3)]">{t}</dt>
      <dd className="font-medium num">{v}</dd>
      {sub ? <dd className="text-xs text-[var(--tinta-3)]">{sub}</dd> : null}
    </div>
  );
}
