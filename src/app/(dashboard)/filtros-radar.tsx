"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Loader, X } from "lucide-react";
import { cn } from "@/lib/ui";

/**
 * FILTROS DO RADAR — pedido do Diego: *"Radar — criar campo para filtro"*.
 *
 * ⚠ O estado vive na URL, não no componente. Três motivos concretos:
 * a fila filtrada pode ser colada num chat para outra pessoa; o F5 não perde o
 * recorte; e o servidor continua sendo quem filtra, então a página não precisa
 * mandar milhares de linhas para o navegador só para escondê-las com CSS.
 *
 * ⚠ Os motivos são chips que ACUMULAM, e não um seletor de um só. A pergunta
 * do vendedor raramente é "quem tem a regra 4" — é "quem tem qualquer coisa de
 * horas", que são três regras.
 */
export function FiltrosDoRadar({
  regras,
  selecionadas,
  dias,
  receita,
  q,
  totalDeSinais,
}: {
  regras: Array<{ codigo: string; nome: string; quantos: number }>;
  selecionadas: string[];
  dias: string;
  receita: string;
  q: string;
  totalDeSinais: number;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pendente, iniciar] = useTransition();

  const aplicar = (mudancas: Record<string, string | null>) => {
    const novo = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(mudancas)) {
      if (v === null || v === "") novo.delete(k);
      else novo.set(k, v);
    }
    const qs = novo.toString();
    iniciar(() => router.push(qs ? `/?${qs}` : "/", { scroll: false }));
  };

  const alternarRegra = (codigo: string) => {
    const set = new Set(selecionadas);
    if (set.has(codigo)) set.delete(codigo);
    else set.add(codigo);
    aplicar({ regra: [...set].join(",") || null });
  };

  const temFiltro = selecionadas.length > 0 || dias || receita || q;

  return (
    <div className="cartao px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[12.5px] font-medium text-[var(--tinta-3)]">Motivo:</span>
          {regras.length === 0 ? (
            <span className="text-[13px] text-[var(--tinta-3)]">
              nenhum gatilho produziu sinal agora
            </span>
          ) : (
            regras.map((r) => {
              const ativa = selecionadas.includes(r.codigo);
              return (
                <button
                  key={r.codigo}
                  onClick={() => alternarRegra(r.codigo)}
                  aria-pressed={ativa}
                  title={`${r.nome} — ${r.quantos} sinal(is)`}
                  className={cn("selo transition-colors", ativa && "selo-info")}
                >
                  {r.nome}
                  <span className={cn("num", ativa ? "" : "text-[var(--tinta-3)]")}>
                    {r.quantos}
                  </span>
                </button>
              );
            })
          )}
        </div>

        {pendente ? (
          <Loader size={14} className="animate-spin text-[var(--tinta-3)]" aria-hidden />
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-[var(--linha)] pt-3">
        <label className="block">
          <span className="mb-1 block text-[11.5px] font-medium text-[var(--tinta-3)]">
            Buscar cliente
          </span>
          <input
            defaultValue={q}
            placeholder="nome"
            className="campo w-44 py-1.5"
            onKeyDown={(e) => {
              if (e.key === "Enter") aplicar({ q: (e.target as HTMLInputElement).value });
            }}
            onBlur={(e) => {
              if (e.target.value !== q) aplicar({ q: e.target.value });
            }}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[11.5px] font-medium text-[var(--tinta-3)]">
            Sem contato há
          </span>
          <select
            value={dias}
            className="campo w-36 py-1.5"
            onChange={(e) => aplicar({ dias: e.target.value })}
          >
            <option value="">qualquer</option>
            <option value="7">mais de 7 dias</option>
            <option value="15">mais de 15 dias</option>
            <option value="30">mais de 30 dias</option>
            <option value="90">mais de 90 dias</option>
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-[11.5px] font-medium text-[var(--tinta-3)]">
            Receita no ano ≥
          </span>
          <input
            type="number"
            defaultValue={receita}
            placeholder="0"
            className="campo num w-32 py-1.5"
            onBlur={(e) => {
              if (e.target.value !== receita) aplicar({ receita: e.target.value });
            }}
          />
        </label>

        <span className="ml-auto flex items-center gap-3 text-[12.5px] text-[var(--tinta-3)]">
          {totalDeSinais.toLocaleString("pt-BR")} sinais ao todo
          {temFiltro ? (
            <button
              className="btn btn-fantasma py-1"
              onClick={() => aplicar({ regra: null, dias: null, receita: null, q: null })}
            >
              <X size={13} aria-hidden /> Limpar
            </button>
          ) : null}
        </span>
      </div>
    </div>
  );
}
