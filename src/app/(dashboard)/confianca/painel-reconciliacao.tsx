"use client";
import { useState, useTransition } from "react";
import { CircleCheck, CircleAlert, TriangleAlert, Loader, type LucideIcon } from "lucide-react";
import { acaoReconciliar } from "@/lib/operacao/actions";
import type { ResultadoReconciliacao } from "@/lib/intel/reconciliar";
import { rotuloMes } from "@/lib/dates";
import { cn } from "@/lib/ui";

/**
 * ⚠ O veredicto tem ÍCONE, PALAVRA e cor. A conferência decide se um número
 * pode alimentar gatilho: se a cor for o único portador, "DIVERGE" e "BATE"
 * ficam iguais para quem não a distingue.
 */
const VEREDICTO: Record<string, { Icone: LucideIcon; classe: string; rotulo: string }> = {
  BATE: { Icone: CircleCheck, classe: "faixa-bom", rotulo: "bate" },
  DIVERGE: { Icone: CircleAlert, classe: "faixa-critico", rotulo: "DIVERGE" },
};
const NADA = { Icone: TriangleAlert, classe: "faixa-atencao", rotulo: "nada conferido" };

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

  const v = r ? (VEREDICTO[r.veredicto] ?? NADA) : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[12.5px]">
          <span className="block text-[var(--tinta-2)]">Mês fechado</span>
          <select
            value={mes}
            onChange={(e) => setMes(e.target.value)}
            className="campo mt-1 w-auto pr-8"
          >
            {meses.map((m) => (
              <option key={m} value={m}>
                {rotuloMes(m)}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={rodar} disabled={pendente || !mes} className="btn">
          {pendente ? <Loader size={14} className="animate-spin" aria-hidden /> : null}
          {pendente ? "Conferindo… (pode levar minutos)" : "Conferir contra o Conexa"}
        </button>
      </div>

      {erro ? (
        <div className="faixa faixa-critico" role="alert">
          <CircleAlert size={16} className="faixa-icone" aria-hidden />
          <div className="min-w-0 flex-1">{erro}</div>
        </div>
      ) : null}

      {r && v ? (
        <div className={cn("cartao overflow-hidden")}>
          <div className={cn("cartao-topo !border-b-0", v.classe)}>
            <div className="flex items-center gap-2 text-[14px] font-semibold">
              <v.Icone size={16} className="faixa-icone" aria-hidden />
              {rotuloMes(r.mesKey)} — {v.rotulo}
            </div>
            <span className="num selo">{r.requisicoes} req.</span>
          </div>

          <div className="space-y-3 px-4 py-3.5">
            {r.observacao ? (
              <p className="text-[13px] leading-relaxed text-[var(--tinta-2)]">{r.observacao}</p>
            ) : null}

            <dl className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3">
              <Par t="Local" v={`R$ ${r.localTotal}`} sub={`${r.localContagem} cobranças`} />
              <Par t="Conexa" v={`R$ ${r.remotoTotal}`} sub={`${r.remotoContagem} cobranças`} />
              <Par
                t="Diferença"
                v={`R$ ${r.diferenca}`}
                destaque={r.veredicto === "DIVERGE" ? "critico" : undefined}
              />
            </dl>

            {r.divergencias.length ? (
              <div className="border-t border-[var(--linha)] pt-3">
                <p className="text-[12.5px] font-semibold">
                  Divergências{r.divergencias.length >= 50 ? " (até 50)" : ""}
                </p>
                <ul className="mt-1.5 space-y-1 text-[11.5px] leading-relaxed text-[var(--tinta-2)]">
                  {r.divergencias.map((d) => (
                    <li key={`${d.chargeId}-${d.motivo}`}>
                      cobrança{" "}
                      <strong className="num font-semibold text-[var(--tinta)]">{d.chargeId}</strong>{" "}
                      — {d.motivo}
                      {d.local ? ` · local R$ ${d.local}` : ""}
                      {d.remoto ? ` · Conexa R$ ${d.remoto}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Par({
  t,
  v,
  sub,
  destaque,
}: {
  t: string;
  v: string;
  sub?: string;
  destaque?: "critico";
}) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-[0.04em] text-[var(--tinta-3)]">{t}</dt>
      <dd
        className={cn(
          "num mt-0.5 text-[16px] font-semibold tracking-[-0.01em]",
          destaque === "critico" && "text-[var(--critico-tinta)]",
        )}
      >
        {v}
      </dd>
      {sub ? <dd className="text-[11.5px] text-[var(--tinta-3)]">{sub}</dd> : null}
    </div>
  );
}
