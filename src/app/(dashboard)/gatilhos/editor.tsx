"use client";
import { useState, useTransition } from "react";
import { ChevronDown, Loader, Plus, RotateCcw, Trash2 } from "lucide-react";
import type { JsonSchema } from "@/lib/mcp/esquema";
import type { GatilhoResolvido } from "@/lib/regras/config";
import { rotuloDaRegra } from "@/lib/regras/catalogo";
import {
  acaoAlternarGatilho,
  acaoCriarGatilho,
  acaoRemoverGatilho,
  acaoRestaurarGatilho,
  acaoSalvarGatilho,
} from "@/lib/operacao/config-actions";
import { Faixa, Painel } from "@/components/Cartao";
import { cn } from "@/lib/ui";

/**
 * EDITOR DE GATILHOS — o pedido do Diego: *"campo editável para criar
 * gatilhos"* e *"gatilhos com possibilidade de editar"*.
 *
 * ⚠ Os campos de parâmetro são desenhados a partir do JSON Schema que o
 * servidor manda, e não de uma lista escrita aqui. É o mesmo esquema que valida
 * a gravação e o mesmo que o MCP publica — então é impossível a tela oferecer
 * um campo que o servidor recusa, ou esconder um que ele aceita. Escrever os
 * campos à mão aqui seria a terceira cópia da mesma verdade.
 */
export function EditorDeGatilhos({
  gatilhos,
  esquemas,
  familias,
  podeEditar,
}: {
  gatilhos: GatilhoResolvido[];
  esquemas: Record<string, JsonSchema>;
  familias: string[];
  podeEditar: boolean;
}) {
  const [aberto, setAberto] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  const rodar = (fn: () => Promise<unknown>) => {
    setErro(null);
    iniciar(async () => {
      try {
        await fn();
      } catch (e) {
        setErro(e instanceof Error ? e.message : String(e));
      }
    });
  };

  const ligados = gatilhos.filter((g) => g.ativo && !g.bloqueio).length;

  return (
    <div className="space-y-3">
      {erro ? (
        <Faixa tom="critico">
          <strong>Não foi possível salvar.</strong> {erro}
        </Faixa>
      ) : null}

      <Painel
        titulo={
          <>
            {gatilhos.length} gatilhos · <strong>{ligados} avaliando</strong>
          </>
        }
        acao={
          podeEditar ? (
            <button className="btn btn-fantasma" onClick={() => setCriando((v) => !v)}>
              <Plus size={14} aria-hidden /> Novo gatilho
            </button>
          ) : null
        }
        rodape={
          <>
            Mudar um limiar <strong>não redispara histórico</strong>: o motor avalia o estado de
            hoje, então a fila muda na próxima vez que a tela abrir. Gatilho nativo se{" "}
            <strong>desliga</strong>, nunca se apaga — o código dele fica gravado nos contatos já
            registrados.
          </>
        }
      >
        {criando && podeEditar ? (
          <NovoGatilho
            familias={familias}
            esquemas={esquemas}
            pendente={pendente}
            onCancelar={() => setCriando(false)}
            onCriar={(d) =>
              rodar(async () => {
                await acaoCriarGatilho(d);
                setCriando(false);
              })
            }
          />
        ) : null}

        <ul className="divide-y divide-[var(--linha)]">
          {gatilhos.map((g) => {
            const expandido = aberto === g.codigo;
            return (
              <li key={g.codigo}>
                <div className="flex flex-wrap items-start gap-3 px-4 py-3">
                  <Interruptor
                    ligado={g.ativo}
                    bloqueado={!!g.bloqueio}
                    desabilitado={!podeEditar || pendente || !!g.bloqueio}
                    onMudar={(v) => rodar(() => acaoAlternarGatilho(g.codigo, v))}
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "font-medium",
                          (!g.ativo || g.bloqueio) && "text-[var(--tinta-3)]",
                        )}
                      >
                        {g.nome}
                      </span>
                      <span className="selo num">
                        {rotuloDaRegra(g.codigo)}
                      </span>
                      <span className="selo">{g.familia.toLowerCase().replace(/_/g, " ")}</span>
                      {g.bloqueio ? (
                        <span className="selo selo-critico">bloqueado</span>
                      ) : !g.ativo ? (
                        <span className="selo selo-atencao">desligado</span>
                      ) : null}
                      {!g.nativo ? <span className="selo selo-info">criado aqui</span> : null}
                      {g.origemDaConfig === "BANCO" && g.nativo ? (
                        <span className="selo" title={`por ${g.atualizadoPor ?? "alguém"}`}>
                          editado
                        </span>
                      ) : null}
                    </div>

                    <p className="mt-1 text-[13.5px] leading-relaxed text-[var(--tinta-2)]">
                      {g.condicao || "—"} → <strong>{g.oferta}</strong>
                    </p>

                    {g.bloqueio ? (
                      <p className="mt-1 text-[13px] leading-relaxed text-[var(--critico-tinta)]">
                        {g.bloqueio}
                      </p>
                    ) : null}
                    {g.problemaNosParams ? (
                      <p className="mt-1 text-[13px] leading-relaxed text-[var(--atencao-tinta)]">
                        ⚠ parâmetros ilegíveis ({g.problemaNosParams}) — avaliando com os valores de
                        fábrica
                      </p>
                    ) : null}
                    {g.nota ? (
                      <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--tinta-3)]">
                        {g.nota}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <ResumoDeParams params={g.params} />
                    <button
                      className="btn btn-fantasma"
                      aria-expanded={expandido}
                      onClick={() => setAberto(expandido ? null : g.codigo)}
                    >
                      {podeEditar ? "Ajustar" : "Ver"}
                      <ChevronDown
                        size={14}
                        aria-hidden
                        className={cn("transition-transform", expandido && "rotate-180")}
                      />
                    </button>
                  </div>
                </div>

                {expandido ? (
                  <FormularioDeGatilho
                    gatilho={g}
                    esquema={esquemas[g.familia]}
                    podeEditar={podeEditar}
                    pendente={pendente}
                    onSalvar={(d) =>
                      rodar(async () => {
                        await acaoSalvarGatilho(g.codigo, d);
                        setAberto(null);
                      })
                    }
                    onRestaurar={
                      g.nativo && g.origemDaConfig === "BANCO"
                        ? () => rodar(() => acaoRestaurarGatilho(g.codigo))
                        : undefined
                    }
                    onRemover={
                      !g.nativo
                        ? () =>
                            rodar(async () => {
                              await acaoRemoverGatilho(g.codigo);
                              setAberto(null);
                            })
                        : undefined
                    }
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      </Painel>
    </div>
  );
}

/** Interruptor acessível. Bloqueado ≠ desligado, e o title diz qual é qual. */
function Interruptor({
  ligado,
  bloqueado,
  desabilitado,
  onMudar,
}: {
  ligado: boolean;
  bloqueado: boolean;
  desabilitado: boolean;
  onMudar: (v: boolean) => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={ligado && !bloqueado}
      disabled={desabilitado}
      onClick={() => onMudar(!ligado)}
      title={
        bloqueado
          ? "bloqueado por permissão da API — ligar não faria efeito"
          : ligado
            ? "desligar este gatilho"
            : "ligar este gatilho"
      }
      className={cn(
        "mt-0.5 h-[22px] w-[38px] shrink-0 rounded-full border p-[2px] transition-colors",
        bloqueado
          ? "cursor-not-allowed border-[var(--linha)] bg-[var(--superficie-sutil)] opacity-50"
          : ligado
            ? "border-transparent bg-[var(--bom)]"
            : "border-[var(--borda)] bg-[var(--superficie-sutil)]",
        desabilitado && !bloqueado && "cursor-not-allowed opacity-60",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "block h-[16px] w-[16px] rounded-full bg-white shadow transition-transform",
          ligado && !bloqueado ? "translate-x-[16px]" : "translate-x-0",
        )}
      />
    </button>
  );
}

function ResumoDeParams({ params }: { params: Record<string, unknown> }) {
  const texto = Object.entries(params)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(" · ");
  if (!texto) return null;
  return (
    <span className="num hidden max-w-[22rem] truncate text-[12px] text-[var(--tinta-3)] lg:inline">
      {texto}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Formulários
// ---------------------------------------------------------------------------

interface EdicaoLocal {
  nome: string;
  oferta: string;
  condicao: string;
  peso: number;
  nota: string;
  params: Record<string, unknown>;
}

function FormularioDeGatilho({
  gatilho,
  esquema,
  podeEditar,
  pendente,
  onSalvar,
  onRestaurar,
  onRemover,
}: {
  gatilho: GatilhoResolvido;
  esquema: JsonSchema | undefined;
  podeEditar: boolean;
  pendente: boolean;
  onSalvar: (d: Partial<EdicaoLocal>) => void;
  onRestaurar?: () => void;
  onRemover?: () => void;
}) {
  const [v, setV] = useState<EdicaoLocal>({
    nome: gatilho.nome,
    oferta: gatilho.oferta,
    condicao: gatilho.condicao,
    peso: gatilho.peso,
    nota: gatilho.nota,
    params: { ...gatilho.params },
  });

  return (
    <div className="border-t border-[var(--linha)] bg-[var(--superficie-sutil)] px-4 py-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Campo rotulo="Nome">
          <input
            className="campo"
            value={v.nome}
            disabled={!podeEditar}
            onChange={(e) => setV({ ...v, nome: e.target.value })}
          />
        </Campo>
        <Campo rotulo="Oferta" dica="o que o vendedor vai propor">
          <input
            className="campo"
            value={v.oferta}
            disabled={!podeEditar}
            onChange={(e) => setV({ ...v, oferta: e.target.value })}
          />
        </Campo>
        <Campo rotulo="Condição" dica="em português, só para a tela">
          <input
            className="campo"
            value={v.condicao}
            disabled={!podeEditar}
            onChange={(e) => setV({ ...v, condicao: e.target.value })}
          />
        </Campo>
        <Campo rotulo="Peso" dica="quanto maior, mais alto na fila do Radar">
          <input
            type="number"
            className="campo num"
            value={v.peso}
            disabled={!podeEditar}
            onChange={(e) => setV({ ...v, peso: Number(e.target.value) })}
          />
        </Campo>
      </div>

      <CamposDeParametro
        esquema={esquema}
        valores={v.params}
        desabilitado={!podeEditar}
        onMudar={(params) => setV({ ...v, params })}
      />

      <Campo rotulo="Nota" className="mt-4">
        <textarea
          className="campo min-h-[60px]"
          value={v.nota}
          disabled={!podeEditar}
          onChange={(e) => setV({ ...v, nota: e.target.value })}
        />
      </Campo>

      {podeEditar ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button className="btn btn-primario" disabled={pendente} onClick={() => onSalvar(v)}>
            {pendente ? <Loader size={14} className="animate-spin" aria-hidden /> : null}
            Salvar
          </button>
          {onRestaurar ? (
            <button
              className="btn btn-fantasma"
              disabled={pendente}
              onClick={onRestaurar}
              title="descarta as edições e volta aos valores do catálogo"
            >
              <RotateCcw size={14} aria-hidden /> Restaurar padrão
            </button>
          ) : null}
          {onRemover ? (
            <button
              className="btn btn-fantasma text-[var(--critico-tinta)]"
              disabled={pendente}
              onClick={onRemover}
            >
              <Trash2 size={14} aria-hidden /> Remover
            </button>
          ) : null}
          {gatilho.atualizadoPor ? (
            <span className="ml-auto text-[12.5px] text-[var(--tinta-3)]">
              última edição por {gatilho.atualizadoPor}
              {gatilho.atualizadoEm
                ? ` em ${new Date(gatilho.atualizadoEm).toLocaleDateString("pt-BR")}`
                : null}
            </span>
          ) : null}
        </div>
      ) : (
        <p className="mt-4 text-[13px] text-[var(--tinta-3)]">
          Seu perfil é somente leitura — os campos acima estão travados.
        </p>
      )}
    </div>
  );
}

function NovoGatilho({
  familias,
  esquemas,
  pendente,
  onCriar,
  onCancelar,
}: {
  familias: string[];
  esquemas: Record<string, JsonSchema>;
  pendente: boolean;
  onCriar: (d: {
    nome: string;
    familia: string;
    oferta: string;
    condicao?: string;
    params?: Record<string, unknown>;
    peso?: number;
  }) => void;
  onCancelar: () => void;
}) {
  const [familia, setFamilia] = useState(familias[0] ?? "MARCO_CONTRATO");
  const [nome, setNome] = useState("");
  const [oferta, setOferta] = useState("");
  const [condicao, setCondicao] = useState("");
  const [peso, setPeso] = useState(50);
  const [params, setParams] = useState<Record<string, unknown>>({});

  return (
    <div className="border-b border-[var(--linha)] bg-[var(--acento-wash)] px-4 py-4">
      <p className="mb-3 max-w-3xl text-[13px] leading-relaxed text-[var(--tinta-2)]">
        Um gatilho novo escolhe uma <strong>família</strong> — a pergunta que o código sabe fazer —
        e ajusta os limiares dela. Ex.: &quot;avisar quando a privativa fizer 3 meses&quot; é um{" "}
        <span className="num">MARCO_CONTRATO</span> com <span className="num">meses: 3</span>.{" "}
        Uma pergunta que nenhuma família faz precisa de código novo, com teste — não de linha de
        tabela.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <Campo rotulo="Família" dica="a pergunta que a regra faz">
          <select className="campo" value={familia} onChange={(e) => { setFamilia(e.target.value); setParams({}); }}>
            {familias.map((f) => (
              <option key={f} value={f}>
                {f.toLowerCase().replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Nome">
          <input className="campo" value={nome} onChange={(e) => setNome(e.target.value)} />
        </Campo>
        <Campo rotulo="Oferta">
          <input className="campo" value={oferta} onChange={(e) => setOferta(e.target.value)} />
        </Campo>
        <Campo rotulo="Condição" dica="em português, só para a tela">
          <input className="campo" value={condicao} onChange={(e) => setCondicao(e.target.value)} />
        </Campo>
      </div>

      <CamposDeParametro
        esquema={esquemas[familia]}
        valores={params}
        desabilitado={false}
        onMudar={setParams}
      />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          className="btn btn-primario"
          disabled={pendente || !nome.trim() || !oferta.trim()}
          onClick={() => onCriar({ nome, familia, oferta, condicao, params, peso })}
        >
          {pendente ? <Loader size={14} className="animate-spin" aria-hidden /> : null}
          Criar gatilho
        </button>
        <button className="btn btn-fantasma" onClick={onCancelar}>
          Cancelar
        </button>
        <span className="num ml-auto flex items-center gap-2 text-[12.5px] text-[var(--tinta-3)]">
          peso
          <input
            type="number"
            className="campo num w-20 py-1"
            value={peso}
            onChange={(e) => setPeso(Number(e.target.value))}
          />
        </span>
      </div>
    </div>
  );
}

/**
 * Desenha um campo por propriedade do JSON Schema da família.
 *
 * ⚠ Nada aqui sabe o nome de nenhum limiar. Acrescentar um parâmetro novo a
 * uma família em `catalogo.ts` faz o campo aparecer nesta tela sozinho — e é
 * por isso que a tela não tem uma lista própria para ficar desatualizada.
 */
function CamposDeParametro({
  esquema,
  valores,
  desabilitado,
  onMudar,
}: {
  esquema: JsonSchema | undefined;
  valores: Record<string, unknown>;
  desabilitado: boolean;
  onMudar: (v: Record<string, unknown>) => void;
}) {
  const props = esquema?.properties;
  if (!props || !Object.keys(props).length) return null;

  const set = (k: string, v: unknown) => onMudar({ ...valores, [k]: v });

  return (
    <fieldset className="mt-4 rounded-[var(--raio-sm)] border border-[var(--linha)] p-3">
      <legend className="px-1.5 text-[12px] font-medium uppercase tracking-wide text-[var(--tinta-3)]">
        Limiares
      </legend>
      <div className="grid gap-4 md:grid-cols-3">
        {Object.entries(props).map(([chave, def]) => {
          const atual = valores[chave] ?? def.default;
          const comum = { disabled: desabilitado, className: "campo" };
          return (
            <Campo key={chave} rotulo={chave} dica={def.description}>
              {def.enum ? (
                <select
                  {...comum}
                  value={String(atual ?? "")}
                  onChange={(e) => set(chave, e.target.value)}
                >
                  {(def.enum as string[]).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : def.type === "boolean" ? (
                <input
                  type="checkbox"
                  disabled={desabilitado}
                  checked={Boolean(atual)}
                  onChange={(e) => set(chave, e.target.checked)}
                  className="h-4 w-4"
                />
              ) : def.type === "number" || def.type === "integer" ? (
                <input
                  {...comum}
                  className="campo num"
                  type="number"
                  step={def.type === "integer" ? 1 : "any"}
                  min={def.minimum}
                  max={def.maximum}
                  value={atual === undefined || atual === null ? "" : String(atual)}
                  onChange={(e) =>
                    set(chave, e.target.value === "" ? undefined : Number(e.target.value))
                  }
                />
              ) : (
                <input
                  {...comum}
                  value={atual === undefined || atual === null ? "" : String(atual)}
                  placeholder={def.pattern}
                  onChange={(e) => set(chave, e.target.value)}
                />
              )}
            </Campo>
          );
        })}
      </div>
    </fieldset>
  );
}

function Campo({
  rotulo,
  dica,
  children,
  className,
}: {
  rotulo: string;
  dica?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1 block text-[12.5px] font-medium text-[var(--tinta-2)]">{rotulo}</span>
      {children}
      {dica ? <span className="mt-1 block text-[11.5px] text-[var(--tinta-3)]">{dica}</span> : null}
    </label>
  );
}
