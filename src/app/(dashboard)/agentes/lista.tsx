"use client";
import { Fragment, useState, useTransition } from "react";
import { Loader, Plus, Trash2, UserPlus } from "lucide-react";
import type { AgenteResumo } from "@/lib/operacao/agentes";
import {
  acaoAtualizarAgente,
  acaoCriarAgente,
  acaoRemoverAgente,
} from "@/lib/operacao/config-actions";
import { Faixa, Painel, Rolante, Vazio } from "@/components/Cartao";
import { cn, iniciais } from "@/lib/ui";

interface NomePendente {
  quem: string;
  contatos: number;
  ultimoEm: string | null;
}

export function ListaDeAgentes({
  agentes,
  podeEditar,
  pendentes,
}: {
  agentes: AgenteResumo[];
  podeEditar: boolean;
  pendentes: NomePendente[];
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [criando, setCriando] = useState<string | null>(null); // nome pré-preenchido
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

  return (
    <div className="space-y-5">
      {erro ? (
        <Faixa tom="critico">
          <strong>Não deu.</strong> {erro}
        </Faixa>
      ) : null}

      {/* ⚠ Os nomes já digitados vêm ANTES do formulário vazio. Um cadastro que
          começa em branco convida a inventar; começando pelos nomes que já
          trabalharam a fila, ele também revela as grafias divergentes da mesma
          pessoa, que é o problema que este cadastro veio resolver. */}
      {pendentes.length > 0 && podeEditar ? (
        <Painel
          titulo={
            pendentes.length === 1 ? (
              <>1 nome digitado que ainda não está no cadastro</>
            ) : (
              <>{pendentes.length} nomes digitados que ainda não estão no cadastro</>
            )
          }
          rodape="Vieram do campo “quem falou com o cliente”, que era texto livre. Cadastrar unifica as grafias — e liga os contatos futuros ao agente."
        >
          <div className="flex flex-wrap gap-2 px-4 py-3">
            {pendentes.map((p) => (
              <button
                key={p.quem}
                className="btn btn-fantasma"
                onClick={() => setCriando(p.quem)}
                title={`${p.contatos} contato(s)${p.ultimoEm ? `, último em ${p.ultimoEm}` : ""}`}
              >
                <UserPlus size={13} aria-hidden />
                {p.quem}
                <span className="num text-[var(--tinta-3)]">{p.contatos}</span>
              </button>
            ))}
          </div>
        </Painel>
      ) : null}

      <Painel
        titulo={`${agentes.length} ${agentes.length === 1 ? "agente" : "agentes"}`}
        acao={
          podeEditar ? (
            <button className="btn btn-fantasma" onClick={() => setCriando(criando === "" ? null : "")}>
              <Plus size={14} aria-hidden /> Cadastrar
            </button>
          ) : null
        }
      >
        {criando !== null && podeEditar ? (
          <Formulario
            titulo="Novo agente"
            inicial={{ nome: criando }}
            pendente={pendente}
            onCancelar={() => setCriando(null)}
            onSalvar={(d) =>
              rodar(async () => {
                await acaoCriarAgente(d);
                setCriando(null);
              })
            }
          />
        ) : null}

        {agentes.length === 0 ? (
          <Vazio Icone={UserPlus}>
            Ninguém cadastrado ainda. Enquanto isso, o campo “quem falou com o cliente” segue
            aceitando texto livre — o cadastro é o que unifica as grafias.
          </Vazio>
        ) : (
          <Rolante>
            <table className="tabela">
              <thead>
                <tr>
                  <th>Agente</th>
                  <th>E-mail</th>
                  <th className="text-right">Contatos</th>
                  <th>Último</th>
                  <th>Disparo</th>
                  <th>Estado</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {agentes.map((a) => (
                  // ⚠ Fragment COM key: o fragmento curto `<>` não aceita key,
                  // e sem ela o React reordena linha de tabela errado quando a
                  // lista muda — a linha de edição aberta gruda no agente vizinho.
                  <Fragment key={a.id}>
                    <tr className={a.ativo ? undefined : "opacity-55"}>
                      <td>
                        <div className="flex items-center gap-2.5">
                          <span
                            aria-hidden
                            className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--acento-wash)] text-[11px] font-semibold text-[var(--acento-tinta)]"
                          >
                            {iniciais(a.nome)}
                          </span>
                          <div className="min-w-0">
                            <button
                              className="font-medium hover:text-[var(--acento-tinta)] hover:underline"
                              onClick={() => setEditando(editando === a.id ? null : a.id)}
                              disabled={!podeEditar}
                            >
                              {a.nome}
                            </button>
                            {a.apelido ? (
                              <div className="text-[12px] text-[var(--tinta-3)]">{a.apelido}</div>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td className="text-[var(--tinta-2)]">{a.email ?? "—"}</td>
                      <td className="num text-right">{a.contatos}</td>
                      <td className="whitespace-nowrap text-[var(--tinta-2)]">
                        {a.ultimoContatoEm
                          ? new Date(a.ultimoContatoEm).toLocaleDateString("pt-BR")
                          : "—"}
                      </td>
                      <td>
                        {/* Preparo do roster. Sem id, a task futura cairia na
                            lista de triagem sem responsável — nunca no chute. */}
                        <span className="flex flex-wrap gap-1">
                          {a.clickupUserId ? (
                            <span className="selo selo-info">ClickUp</span>
                          ) : null}
                          {a.chatwootAgentId ? (
                            <span className="selo selo-info">Chatwoot</span>
                          ) : null}
                          {!a.clickupUserId && !a.chatwootAgentId ? (
                            <span className="text-[var(--tinta-3)]">—</span>
                          ) : null}
                        </span>
                      </td>
                      <td>
                        <span className={cn("selo", a.ativo ? "selo-bom" : "")}>
                          {a.ativo ? "ativo" : "inativo"}
                        </span>
                      </td>
                      <td className="pr-3 text-right">
                        {podeEditar && a.contatos === 0 ? (
                          <button
                            onClick={() => rodar(() => acaoRemoverAgente(a.id))}
                            disabled={pendente}
                            aria-label={`Remover ${a.nome}`}
                            title="remover — só possível porque nunca registrou contato"
                            className="text-[var(--tinta-3)] hover:text-[var(--critico-tinta)]"
                          >
                            <Trash2 size={14} />
                          </button>
                        ) : null}
                      </td>
                    </tr>
                    {editando === a.id && podeEditar ? (
                      <tr>
                        <td colSpan={7} className="!p-0">
                          <Formulario
                            titulo={`Editar ${a.nome}`}
                            inicial={a}
                            pendente={pendente}
                            comAtivo
                            onCancelar={() => setEditando(null)}
                            onSalvar={(d) =>
                              rodar(async () => {
                                await acaoAtualizarAgente(a.id, d);
                                setEditando(null);
                              })
                            }
                          />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </Rolante>
        )}
      </Painel>
    </div>
  );
}

interface Dados {
  nome: string;
  email?: string | null;
  apelido?: string | null;
  clickupUserId?: string | null;
  chatwootAgentId?: string | null;
  observacao?: string | null;
  ativo?: boolean;
}

function Formulario({
  titulo,
  inicial,
  pendente,
  comAtivo,
  onSalvar,
  onCancelar,
}: {
  titulo: string;
  inicial: Partial<Dados>;
  pendente: boolean;
  comAtivo?: boolean;
  onSalvar: (d: Dados) => void;
  onCancelar: () => void;
}) {
  const [v, setV] = useState<Dados>({
    nome: inicial.nome ?? "",
    email: inicial.email ?? "",
    apelido: inicial.apelido ?? "",
    clickupUserId: inicial.clickupUserId ?? "",
    chatwootAgentId: inicial.chatwootAgentId ?? "",
    observacao: inicial.observacao ?? "",
    ativo: inicial.ativo ?? true,
  });

  return (
    <div className="border-y border-[var(--linha)] bg-[var(--superficie-sutil)] px-4 py-4">
      <div className="mb-3 text-[13px] font-medium text-[var(--tinta-2)]">{titulo}</div>
      <div className="grid gap-4 md:grid-cols-3">
        <Campo rotulo="Nome">
          <input className="campo" value={v.nome} onChange={(e) => setV({ ...v, nome: e.target.value })} />
        </Campo>
        <Campo rotulo="E-mail" dica="opcional — nem todo mundo tem corporativo">
          <input
            className="campo"
            value={v.email ?? ""}
            onChange={(e) => setV({ ...v, email: e.target.value })}
          />
        </Campo>
        <Campo rotulo="Apelido" dica="como o nome costuma ser digitado">
          <input
            className="campo"
            value={v.apelido ?? ""}
            onChange={(e) => setV({ ...v, apelido: e.target.value })}
          />
        </Campo>
        <Campo rotulo="ClickUp user id" dica="roster do disparo futuro">
          <input
            className="campo num"
            value={v.clickupUserId ?? ""}
            onChange={(e) => setV({ ...v, clickupUserId: e.target.value })}
          />
        </Campo>
        <Campo rotulo="Chatwoot agent id" dica="roster do disparo futuro">
          <input
            className="campo num"
            value={v.chatwootAgentId ?? ""}
            onChange={(e) => setV({ ...v, chatwootAgentId: e.target.value })}
          />
        </Campo>
        <Campo rotulo="Observação">
          <input
            className="campo"
            value={v.observacao ?? ""}
            onChange={(e) => setV({ ...v, observacao: e.target.value })}
          />
        </Campo>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          className="btn btn-primario"
          disabled={pendente || !v.nome.trim()}
          onClick={() => onSalvar(v)}
        >
          {pendente ? <Loader size={14} className="animate-spin" aria-hidden /> : null}
          Salvar
        </button>
        <button className="btn btn-fantasma" onClick={onCancelar}>
          Cancelar
        </button>
        {comAtivo ? (
          <label className="ml-auto flex items-center gap-2 text-[13px] text-[var(--tinta-2)]">
            <input
              type="checkbox"
              checked={v.ativo ?? true}
              onChange={(e) => setV({ ...v, ativo: e.target.checked })}
              className="h-4 w-4"
            />
            ativo
          </label>
        ) : null}
      </div>
    </div>
  );
}

function Campo({
  rotulo,
  dica,
  children,
}: {
  rotulo: string;
  dica?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12.5px] font-medium text-[var(--tinta-2)]">{rotulo}</span>
      {children}
      {dica ? <span className="mt-1 block text-[11.5px] text-[var(--tinta-3)]">{dica}</span> : null}
    </label>
  );
}
