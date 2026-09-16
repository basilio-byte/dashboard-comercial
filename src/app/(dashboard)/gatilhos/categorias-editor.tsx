"use client";
import { useMemo, useState, useTransition } from "react";
import { Loader, Search, X } from "lucide-react";
import type { SegmentoCategoria } from "@prisma/client";
import type { LeituraDeCategoria } from "@/lib/regras/segmentos";
import { acaoClassificarCategoria, acaoLimparClassificacao } from "@/lib/operacao/config-actions";
import { Faixa, Painel, Rolante } from "@/components/Cartao";
import { cn } from "@/lib/ui";

/**
 * A tabela de categorias, com a classificação editável na própria linha.
 *
 * ⚠ Mostra a coluna "pelo nome" ao lado de "lida como" mesmo quando o manual
 * venceu. É o único jeito de perceber que o Conexa renomeou uma categoria: o
 * segmento continua certo (porque é por id), e a sugestão do nome muda. Sem as
 * duas colunas, a renomeação fica invisível — que era o defeito original.
 */
export function EditorDeCategorias({
  categorias,
  segmentos,
  rotulos,
  destrava,
  podeEditar,
}: {
  categorias: LeituraDeCategoria[];
  segmentos: SegmentoCategoria[];
  rotulos: Record<SegmentoCategoria, string>;
  destrava: Record<SegmentoCategoria, string>;
  podeEditar: boolean;
}) {
  const [busca, setBusca] = useState("");
  const [soEmUso, setSoEmUso] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState<number | null>(null);
  const [, iniciar] = useTransition();

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return categorias
      .filter((c) => (soEmUso ? c.planos > 0 : true))
      .filter((c) => (q ? c.nome.toLowerCase().includes(q) || String(c.conexaId).includes(q) : true))
      // Não reconhecidas primeiro: são as que pedem decisão.
      .sort((a, b) => {
        const peso = (c: LeituraDeCategoria) => (c.segmento === null ? 0 : c.origem === "MANUAL" ? 2 : 1);
        return peso(a) - peso(b) || b.planos - a.planos || a.nome.localeCompare(b.nome);
      });
  }, [categorias, busca, soEmUso]);

  const rodar = (id: number, fn: () => Promise<unknown>) => {
    setErro(null);
    setSalvando(id);
    iniciar(async () => {
      try {
        await fn();
      } catch (e) {
        setErro(e instanceof Error ? e.message : String(e));
      } finally {
        setSalvando(null);
      }
    });
  };

  return (
    <div className="space-y-3">
      {erro ? (
        <Faixa tom="critico">
          <strong>Não foi possível classificar.</strong> {erro}
        </Faixa>
      ) : null}

      <Painel
        titulo={
          <div className="flex flex-wrap items-center gap-3">
            <span>
              {visiveis.length} {visiveis.length === 1 ? "categoria" : "categorias"}
            </span>
            <label className="flex items-center gap-1.5 text-[12.5px] font-normal text-[var(--tinta-3)]">
              <input
                type="checkbox"
                checked={soEmUso}
                onChange={(e) => setSoEmUso(e.target.checked)}
                className="h-3.5 w-3.5"
              />
              só as com plano
            </label>
          </div>
        }
        acao={
          <div className="relative">
            <Search
              size={14}
              aria-hidden
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--tinta-3)]"
            />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar categoria"
              className="campo w-full py-1.5 pl-8 sm:w-56"
            />
          </div>
        }
        rodape={
          <>
            Categoria <strong>sem plano</strong> não classifica contrato nenhum — por isso o filtro
            vem ligado. A classificação é por <strong>id</strong>: renomear no Conexa não a perde.
          </>
        }
      >
        <Rolante>
          <table className="tabela">
            <thead>
              <tr>
                <th>Categoria</th>
                <th className="text-right">Planos</th>
                <th>Lida como</th>
                <th>Pelo nome</th>
                <th>Unidade</th>
                <th>Destrava</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {visiveis.map((c) => (
                <tr key={c.conexaId} className={c.segmento === null ? "opacity-80" : undefined}>
                  <td>
                    {/* ⚠ `whitespace-pre` de propósito: espaço duplo no nome é
                        exatamente o defeito do ADR-0017 do irmão, e escondê-lo
                        no HTML seria apagar a evidência. */}
                    <span className="whitespace-pre font-medium">{c.nome}</span>
                    <span className="num selo ml-2">#{c.conexaId}</span>
                    {c.rotulo ? (
                      <div className="mt-0.5 text-[12px] text-[var(--tinta-3)]">
                        exibida como &quot;{c.rotulo}&quot;
                      </div>
                    ) : null}
                  </td>
                  <td className="num text-right text-[var(--tinta-2)]">{c.planos}</td>
                  <td>
                    <select
                      className="campo w-full min-w-[9.5rem] py-1 text-[13px]"
                      disabled={!podeEditar || salvando === c.conexaId}
                      value={c.origem === "MANUAL" ? c.segmento ?? "" : ""}
                      onChange={(e) =>
                        rodar(c.conexaId, () =>
                          e.target.value
                            ? acaoClassificarCategoria(c.conexaId, { segmento: e.target.value })
                            : acaoLimparClassificacao(c.conexaId),
                        )
                      }
                    >
                      <option value="">
                        {c.origem === "NOME"
                          ? `— pelo nome: ${rotulos[c.segmento!]}`
                          : "— não classificada"}
                      </option>
                      {segmentos.map((s) => (
                        <option key={s} value={s}>
                          {rotulos[s]}
                        </option>
                      ))}
                    </select>
                    {c.origem === "MANUAL" ? (
                      <div className="mt-0.5 text-[11.5px] text-[var(--tinta-3)]">
                        por {c.definidoPor ?? "alguém"}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    {c.sugestaoPeloNome ? (
                      <span
                        className={cn(
                          "selo",
                          c.origem === "MANUAL" && c.sugestaoPeloNome !== c.segmento
                            ? "selo-atencao"
                            : "",
                        )}
                        title={
                          c.origem === "MANUAL" && c.sugestaoPeloNome !== c.segmento
                            ? "diverge da classificação manual — o Conexa pode ter renomeado"
                            : undefined
                        }
                      >
                        {rotulos[c.sugestaoPeloNome]}
                      </span>
                    ) : (
                      <span className="text-[var(--tinta-3)]">—</span>
                    )}
                  </td>
                  <td>
                    <CampoUnidade
                      valor={c.unidade}
                      desabilitado={!podeEditar || !c.segmento || salvando === c.conexaId}
                      onSalvar={(unidade) =>
                        rodar(c.conexaId, () =>
                          acaoClassificarCategoria(c.conexaId, {
                            segmento: (c.segmento ?? "OUTRO") as string,
                            unidade,
                          }),
                        )
                      }
                    />
                  </td>
                  <td className="text-[13px] text-[var(--tinta-3)]">
                    {c.segmento ? destrava[c.segmento] : "nenhuma"}
                  </td>
                  <td className="pr-3 text-right">
                    {salvando === c.conexaId ? (
                      <Loader size={14} className="animate-spin text-[var(--tinta-3)]" aria-hidden />
                    ) : c.origem === "MANUAL" && podeEditar ? (
                      <button
                        onClick={() => rodar(c.conexaId, () => acaoLimparClassificacao(c.conexaId))}
                        title="limpar a classificação manual — volta a ser lida pelo nome"
                        aria-label={`Limpar classificação de ${c.nome}`}
                        className="text-[var(--tinta-3)] hover:text-[var(--critico-tinta)]"
                      >
                        <X size={14} />
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Rolante>
      </Painel>
    </div>
  );
}

/** Texto livre com gravação no blur — unidade é nome próprio, não enum. */
function CampoUnidade({
  valor,
  desabilitado,
  onSalvar,
}: {
  valor: string | null;
  desabilitado: boolean;
  onSalvar: (v: string) => void;
}) {
  const [texto, setTexto] = useState(valor ?? "");
  return (
    <input
      className="campo w-full min-w-[8rem] py-1 text-[13px]"
      placeholder={desabilitado ? "—" : "ex.: Sebrae"}
      value={texto}
      disabled={desabilitado}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={() => {
        if (texto.trim() !== (valor ?? "").trim()) onSalvar(texto.trim());
      }}
    />
  );
}
