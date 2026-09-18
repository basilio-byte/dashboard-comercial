"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader, Search, SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/ui";

/**
 * FILTROS DA CARTEIRA — pedido do Diego: *"incluir espaço para filtros (receita,
 * plano, horas contratadas, horas disponíveis, estourou o pacote de horas...) +
 * possibilidade de mesclar filtros assim como no ClickUp"*.
 *
 * ⚠ Todo filtro ACUMULA, e a ordenação é independente — é o "mesclar" do
 * pedido. O exemplo dele, *"filtrar por Plano X + Receita de maior para
 * menor"*, é plano no seletor e receita/desc na ordenação, ao mesmo tempo.
 *
 * ⚠ **A lacuna de "horas disponíveis" fica VISÍVEL na tela**, e não escondida
 * numa decisão de implementação. Quem procura o filtro precisa encontrar o
 * motivo de ele não existir — senão pergunta de novo daqui a três meses, ou
 * pior, conclui que o sistema é incompleto sem saber que depende de uma
 * liberação de terceiro.
 */

interface Opcoes {
  segmentos: string[];
  segmentosClassificados: Array<{ segmento: string; rotulo: string }>;
  unidades: string[];
  planos: Array<{ conexaId: number; nome: string; horasInclusasMes: number | null; contratos: number }>;
  categorias: Array<{ conexaId: number; nome: string }>;
}

export function FiltrosDaCarteira({
  opcoes,
  valores,
  lacunas,
}: {
  opcoes: Opcoes;
  valores: Record<string, string | undefined>;
  lacunas: string[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pendente, iniciar] = useTransition();
  const [avancado, setAvancado] = useState(
    Boolean(valores.horasMin || valores.horasMax || valores.unidade || valores.categoria || valores.dias || valores.inelegiveis),
  );

  const aplicar = (mudancas: Record<string, string | null>) => {
    const novo = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(mudancas)) {
      if (v === null || v === "") novo.delete(k);
      else novo.set(k, v);
    }
    // Qualquer mudança de filtro volta para a primeira página: manter a página
    // 7 depois de cortar a lista para 30 resultados mostra um vazio que parece
    // "nenhum cliente" e é só paginação velha.
    novo.delete("pagina");
    const qs = novo.toString();
    iniciar(() => router.push(qs ? `/carteira?${qs}` : "/carteira", { scroll: false }));
  };

  const v = (k: string) => valores[k] ?? "";
  const ativos = [
    "q", "segmento", "seg", "plano", "categoria", "unidade", "receitaMin", "receitaMax",
    "horasMin", "horasMax", "semCota", "contrato", "estourou", "dias", "inelegiveis",
  ].filter((k) => v(k)).length;

  return (
    <div className="cartao px-4 py-3.5">
      {/* Linha 1: o que se usa todo dia. */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="block min-w-[12rem] flex-1">
          <Rotulo>Buscar</Rotulo>
          <div className="relative">
            <Search
              size={14}
              aria-hidden
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--tinta-3)]"
            />
            <input
              defaultValue={v("q")}
              placeholder="nome, nome fantasia ou CNPJ"
              className="campo py-1.5 pl-8"
              onKeyDown={(e) => {
                if (e.key === "Enter") aplicar({ q: (e.target as HTMLInputElement).value });
              }}
              onBlur={(e) => {
                if (e.target.value !== v("q")) aplicar({ q: e.target.value });
              }}
            />
          </div>
        </label>

        <label className="block">
          <Rotulo>Plano</Rotulo>
          <select
            value={v("plano")}
            className="campo w-52 py-1.5"
            onChange={(e) => aplicar({ plano: e.target.value })}
          >
            <option value="">todos</option>
            {opcoes.planos.map((p) => (
              <option key={p.conexaId} value={p.conexaId}>
                {p.nome} ({p.contratos})
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <Rotulo>Segmento</Rotulo>
          {/* A classificação da tela Gatilhos — a mesma que as regras usam. */}
          <select
            value={v("seg")}
            className="campo w-44 py-1.5"
            onChange={(e) => aplicar({ seg: e.target.value })}
          >
            <option value="">todos</option>
            {opcoes.segmentosClassificados.map((s) => (
              <option key={s.segmento} value={s.segmento}>
                {s.rotulo}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <Rotulo>Receita no ano ≥</Rotulo>
          <input
            type="number"
            defaultValue={v("receitaMin")}
            placeholder="0"
            className="campo num w-28 py-1.5"
            onBlur={(e) => {
              if (e.target.value !== v("receitaMin")) aplicar({ receitaMin: e.target.value });
            }}
          />
        </label>

        <label className="block">
          <Rotulo>Ordenar por</Rotulo>
          <select
            value={v("ordem") || "receita"}
            className="campo w-40 py-1.5"
            onChange={(e) => aplicar({ ordem: e.target.value })}
          >
            <option value="receita">receita no ano</option>
            <option value="nome">nome</option>
            <option value="horas">horas contratadas</option>
            <option value="variacao">variação do mês</option>
            <option value="contratoDesde">início do contrato</option>
          </select>
        </label>

        <label className="block">
          <Rotulo>Direção</Rotulo>
          <select
            value={v("dir") || "desc"}
            className="campo w-32 py-1.5"
            onChange={(e) => aplicar({ dir: e.target.value })}
          >
            <option value="desc">maior → menor</option>
            <option value="asc">menor → maior</option>
          </select>
        </label>

        {pendente ? (
          <Loader size={15} className="mb-2 animate-spin text-[var(--tinta-3)]" aria-hidden />
        ) : null}
      </div>

      {/* Linha 2: alternadores de três estados — "tanto faz" é um valor. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--linha)] pt-3">
        <Tri
          rotulo="Estoura a cota"
          valor={v("estourou")}
          dica="paga horas por fora do plano com recorrência"
          onMudar={(x) => aplicar({ estourou: x })}
        />
        <Tri
          rotulo="Sem cota (Litoral)"
          valor={v("semCota")}
          dica="plano sem horas inclusas — não é zero hora"
          onMudar={(x) => aplicar({ semCota: x })}
        />
        <Tri
          rotulo="Com contrato ativo"
          valor={v("contrato")}
          onMudar={(x) => aplicar({ contrato: x })}
        />

        <button
          className={cn("btn btn-fantasma ml-auto py-1", avancado && "text-[var(--acento-tinta)]")}
          onClick={() => setAvancado((x) => !x)}
          aria-expanded={avancado}
        >
          <SlidersHorizontal size={13} aria-hidden /> Mais filtros
        </button>
        {ativos > 0 ? (
          <button
            className="btn btn-fantasma py-1"
            onClick={() =>
              aplicar({
                q: null, segmento: null, seg: null, plano: null, categoria: null, unidade: null,
                receitaMin: null, receitaMax: null, horasMin: null, horasMax: null,
                semCota: null, contrato: null, estourou: null, dias: null, inelegiveis: null,
              })
            }
          >
            <X size={13} aria-hidden /> Limpar {ativos}
          </button>
        ) : null}
      </div>

      {avancado ? (
        <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-[var(--linha)] pt-3">
          <label className="block">
            <Rotulo>Horas contratadas</Rotulo>
            <span className="flex items-center gap-1.5">
              <input
                type="number"
                defaultValue={v("horasMin")}
                placeholder="mín"
                className="campo num w-20 py-1.5"
                onBlur={(e) => aplicar({ horasMin: e.target.value })}
              />
              <span className="text-[var(--tinta-3)]">–</span>
              <input
                type="number"
                defaultValue={v("horasMax")}
                placeholder="máx"
                className="campo num w-20 py-1.5"
                onBlur={(e) => aplicar({ horasMax: e.target.value })}
              />
            </span>
          </label>

          <label className="block">
            <Rotulo>Receita ≤</Rotulo>
            <input
              type="number"
              defaultValue={v("receitaMax")}
              placeholder="sem teto"
              className="campo num w-28 py-1.5"
              onBlur={(e) => aplicar({ receitaMax: e.target.value })}
            />
          </label>

          <label className="block">
            <Rotulo>Unidade</Rotulo>
            <select
              value={v("unidade")}
              className="campo w-40 py-1.5"
              onChange={(e) => aplicar({ unidade: e.target.value })}
            >
              <option value="">todas</option>
              {opcoes.unidades.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <Rotulo>Categoria de serviço</Rotulo>
            <select
              value={v("categoria")}
              className="campo w-56 py-1.5"
              onChange={(e) => aplicar({ categoria: e.target.value })}
            >
              <option value="">todas</option>
              {opcoes.categorias.map((c) => (
                <option key={c.conexaId} value={c.conexaId}>
                  {c.nome}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <Rotulo>Sem contato há</Rotulo>
            <select
              value={v("dias")}
              className="campo w-36 py-1.5"
              onChange={(e) => aplicar({ dias: e.target.value })}
            >
              <option value="">qualquer</option>
              <option value="30">mais de 30 dias</option>
              <option value="90">mais de 90 dias</option>
              <option value="180">mais de 180 dias</option>
            </select>
          </label>

          <label className="mb-2 flex items-center gap-2 text-[13px] text-[var(--tinta-2)]">
            <input
              type="checkbox"
              checked={v("inelegiveis") === "1"}
              onChange={(e) => aplicar({ inelegiveis: e.target.checked ? "1" : null })}
              className="h-4 w-4"
            />
            incluir inativos e bloqueados
          </label>

          {opcoes.unidades.length === 0 ? (
            <p className="w-full text-[12px] text-[var(--tinta-3)]">
              Nenhuma unidade disponível: as unidades vêm das categorias classificadas à mão, em{" "}
              <strong>Gatilhos → Como as categorias são lidas</strong>.
            </p>
          ) : null}
        </div>
      ) : null}

      {/* ⚠ A lacuna aparece, sempre. É o que faz alguém levar a pergunta ao
          Conexa em vez de procurar um filtro que não pode existir. */}
      {lacunas.map((l) => (
        <p key={l} className="mt-3 border-t border-[var(--linha)] pt-2.5 text-[12px] leading-relaxed text-[var(--tinta-3)]">
          <span className="selo selo-atencao mr-1.5">não filtrável</span>
          {l}
        </p>
      ))}
    </div>
  );
}

function Rotulo({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1 block text-[11.5px] font-medium text-[var(--tinta-3)]">{children}</span>
  );
}

/**
 * Alternador de TRÊS estados: sim, não, tanto faz.
 *
 * ⚠ Um checkbox de dois estados confunde "não quero filtrar por isso" com
 * "quero só quem NÃO tem" — e a segunda leitura esconde silenciosamente a
 * maioria da carteira.
 */
function Tri({
  rotulo,
  valor,
  dica,
  onMudar,
}: {
  rotulo: string;
  valor: string;
  dica?: string;
  onMudar: (v: string | null) => void;
}) {
  const opcoes: Array<{ v: string | null; r: string }> = [
    { v: null, r: "tanto faz" },
    { v: "1", r: "sim" },
    { v: "0", r: "não" },
  ];
  return (
    <span className="flex items-center gap-2" title={dica}>
      <span className="text-[12.5px] font-medium text-[var(--tinta-2)]">{rotulo}</span>
      <span className="flex overflow-hidden rounded-full border border-[var(--borda)]">
        {opcoes.map((o) => {
          const ativo = (o.v ?? "") === valor;
          return (
            <button
              key={o.r}
              onClick={() => onMudar(o.v)}
              aria-pressed={ativo}
              className={cn(
                "px-2.5 py-1 text-[12px] transition-colors",
                ativo
                  ? "bg-[var(--acento-wash)] font-semibold text-[var(--acento-tinta)]"
                  : "text-[var(--tinta-3)] hover:bg-[var(--superficie-sutil)]",
              )}
            >
              {o.r}
            </button>
          );
        })}
      </span>
    </span>
  );
}
