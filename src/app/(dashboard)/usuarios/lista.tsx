"use client";
import { Fragment, useState, useTransition } from "react";
import { Check, Copy, DoorClosed, KeyRound, Loader, Plus, UserPlus, Wand2 } from "lucide-react";
import type { UsuarioListado } from "@/lib/operacao/usuarios";
import {
  acaoAtualizarUsuario,
  acaoCriarUsuario,
  acaoRedefinirSenha,
} from "@/lib/operacao/usuarios-actions";
import { PAPEIS, senhaTemporaria, type Papel } from "@/lib/operacao/usuarios-regras";
import { Faixa, Painel, Rolante } from "@/components/Cartao";
import { cn, iniciais } from "@/lib/ui";

/**
 * A lista de usuários e o formulário de criação.
 *
 * ⚠ A senha aparece UMA vez, como o token do MCP: o banco guarda só o bcrypt.
 * A tela diz isso antes e depois, porque a reação natural a "perdi a senha do
 * Diego" é procurar onde vê-la de novo.
 */

const ROTULO_PAPEL: Record<Papel, string> = {
  ADMIN: "Administrador",
  COMERCIAL: "Comercial",
  VIEWER: "Consulta",
};

function sortear(n: number): number[] {
  const buf = new Uint32Array(n);
  crypto.getRandomValues(buf);
  return Array.from(buf);
}

const dia = (d: Date | string | null) =>
  d ? new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : null;

export function ListaDeUsuarios({
  usuarios,
  euId,
  batendo,
}: {
  usuarios: UsuarioListado[];
  euId: string;
  batendo: Array<{ email: string; tentativas: number; ultimaEm: Date }>;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState<{ email: string } | null>(null);
  const [senhaNova, setSenhaNova] = useState<{ email: string; senha: string } | null>(null);
  const [redefinindo, setRedefinindo] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
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

  const copiar = (texto: string) => {
    navigator.clipboard.writeText(texto).then(() => {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    });
  };

  return (
    <div className="space-y-5">
      {erro ? (
        <Faixa tom="critico">
          <strong>Não deu.</strong> {erro}
        </Faixa>
      ) : null}

      {senhaNova ? (
        <Faixa tom="bom">
          <div className="space-y-1.5">
            <div>
              <strong>Senha de {senhaNova.email}.</strong> Ela aparece <strong>uma vez</strong> —
              copie e entregue à pessoa; depois disso só é possível redefinir.
            </div>
            <div className="flex items-center gap-2">
              <code className="rounded-sm bg-[var(--superficie-sutil)] px-2 py-1 text-[13px]">
                {senhaNova.senha}
              </code>
              <button className="btn btn-fantasma" onClick={() => copiar(senhaNova.senha)}>
                {copiado ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
                {copiado ? "copiada" : "copiar"}
              </button>
              <button className="btn btn-fantasma" onClick={() => setSenhaNova(null)}>
                já anotei
              </button>
            </div>
          </div>
        </Faixa>
      ) : null}

      {/* ⚠ Quem TENTOU entrar e não tem conta vem antes do formulário vazio. É
          o dado que responde "o Diego não consegue entrar" sem adivinhar o
          e-mail dele — e foi assim que se descobriu que ele nunca teve conta. */}
      {batendo.length > 0 ? (
        <Painel
          titulo="Tentaram entrar e não têm conta"
          rodape="E-mails com falha “e-mail inexistente” nos últimos 30 dias. Clique para criar a conta já com o e-mail que a pessoa usou."
        >
          <div className="flex flex-wrap gap-2 px-4 py-3">
            {batendo.map((b) => (
              <button
                key={b.email}
                className="btn btn-fantasma"
                onClick={() => setCriando({ email: b.email })}
                title={`${b.tentativas} tentativa(s), última em ${dia(b.ultimaEm)}`}
              >
                <UserPlus size={13} aria-hidden />
                {b.email}
                <span className="num text-[var(--tinta-3)]">{b.tentativas}</span>
              </button>
            ))}
          </div>
        </Painel>
      ) : null}

      <Painel
        titulo={`${usuarios.length} ${usuarios.length === 1 ? "usuário" : "usuários"}`}
        acao={
          <button
            className="btn btn-fantasma"
            onClick={() => setCriando(criando ? null : { email: "" })}
          >
            <Plus size={14} aria-hidden /> Criar usuário
          </button>
        }
      >
        {criando ? (
          <Formulario
            inicial={criando.email}
            pendente={pendente}
            onCancelar={() => setCriando(null)}
            onCriar={(d) =>
              rodar(async () => {
                await acaoCriarUsuario(d);
                setCriando(null);
                setSenhaNova({ email: d.email, senha: d.senha });
              })
            }
          />
        ) : null}

        <Rolante>
          <table className="tabela">
            <thead>
              <tr>
                <th>Pessoa</th>
                <th>Perfil</th>
                <th>Último acesso</th>
                <th>Sessões</th>
                <th>Falhas 7d</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {usuarios.map((u) => (
                <Fragment key={u.id}>
                  <tr className={cn(!u.ativo && "opacity-60")}>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--superficie-sutil)] text-[11px] font-semibold">
                          {iniciais(u.nome)}
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 truncate font-medium">
                            {u.nome}
                            {u.id === euId ? <span className="selo">você</span> : null}
                            {!u.ativo ? <span className="selo selo-atencao">desativado</span> : null}
                          </div>
                          <div className="truncate text-[12px] text-[var(--tinta-3)]">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <select
                        className="campo"
                        value={u.papel}
                        disabled={pendente}
                        onChange={(e) =>
                          rodar(() => acaoAtualizarUsuario(u.id, { papel: e.target.value as Papel }))
                        }
                      >
                        {PAPEIS.map((p) => (
                          <option key={p.papel} value={p.papel}>
                            {p.rotulo}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="num">
                      {dia(u.ultimoLoginEm) ?? (
                        <span className="text-[var(--tinta-3)]">nunca entrou</span>
                      )}
                    </td>
                    <td className="num">{u.sessoesAtivas}</td>
                    <td className="num">
                      {u.falhas7d > 0 ? (
                        <span className={cn(u.falhas7d >= 3 && "text-[var(--atencao)]")}>
                          {u.falhas7d}
                        </span>
                      ) : (
                        <span className="text-[var(--tinta-3)]">—</span>
                      )}
                    </td>
                    <td>
                      <div className="flex justify-end gap-1.5">
                        <button
                          className="btn btn-fantasma"
                          disabled={pendente}
                          onClick={() => setRedefinindo(redefinindo === u.id ? null : u.id)}
                        >
                          <KeyRound size={13} aria-hidden /> senha
                        </button>
                        <button
                          className="btn btn-fantasma"
                          disabled={pendente}
                          onClick={() => rodar(() => acaoAtualizarUsuario(u.id, { ativo: !u.ativo }))}
                        >
                          {u.ativo ? <DoorClosed size={13} aria-hidden /> : null}
                          {u.ativo ? "desativar" : "reativar"}
                        </button>
                      </div>
                    </td>
                  </tr>

                  {redefinindo === u.id ? (
                    <tr>
                      <td colSpan={6} className="bg-[var(--superficie-sutil)]">
                        <RedefinirSenha
                          pendente={pendente}
                          onCancelar={() => setRedefinindo(null)}
                          onConfirmar={(senha) =>
                            rodar(async () => {
                              await acaoRedefinirSenha(u.id, senha);
                              setRedefinindo(null);
                              setSenhaNova({ email: u.email, senha });
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
      </Painel>

      <p className="text-[12px] leading-relaxed text-[var(--tinta-3)]">
        Trocar o perfil ou desativar <strong>encerra as sessões</strong> da pessoa na hora —
        permissão antiga não sobrevive até a sessão expirar. Redefinir a senha também encerra.
      </p>
    </div>
  );
}

function Formulario({
  inicial,
  pendente,
  onCriar,
  onCancelar,
}: {
  inicial: string;
  pendente: boolean;
  onCriar: (d: { nome: string; email: string; senha: string; papel: Papel }) => void;
  onCancelar: () => void;
}) {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState(inicial);
  const [papel, setPapel] = useState<Papel>("COMERCIAL");
  const [senha, setSenha] = useState(() => senhaTemporaria(sortear));

  return (
    <div className="space-y-3 border-b border-[var(--linha)] bg-[var(--superficie-sutil)] px-4 py-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-[12px] text-[var(--tinta-2)]">Nome</span>
          <input
            className="campo w-full"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Diego Sena"
            autoFocus
          />
        </label>
        <label className="space-y-1">
          <span className="text-[12px] text-[var(--tinta-2)]">E-mail</span>
          <input
            className="campo w-full"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="diego@seahubcoworking.com.br"
            inputMode="email"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[12px] text-[var(--tinta-2)]">Perfil</span>
          <select className="campo w-full" value={papel} onChange={(e) => setPapel(e.target.value as Papel)}>
            {PAPEIS.map((p) => (
              <option key={p.papel} value={p.papel}>
                {p.rotulo} — {p.descricao}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[12px] text-[var(--tinta-2)]">Senha inicial</span>
          <div className="flex gap-1.5">
            <input className="campo w-full" value={senha} onChange={(e) => setSenha(e.target.value)} />
            <button
              type="button"
              className="btn btn-fantasma shrink-0"
              onClick={() => setSenha(senhaTemporaria(sortear))}
              title="Sortear outra"
            >
              <Wand2 size={13} aria-hidden />
            </button>
          </div>
        </label>
      </div>

      <div className="flex items-center gap-2">
        <button
          className="btn btn-primario"
          disabled={pendente}
          onClick={() => onCriar({ nome, email, senha, papel })}
        >
          {pendente ? <Loader size={13} className="animate-spin" aria-hidden /> : null}
          Criar
        </button>
        <button className="btn btn-fantasma" disabled={pendente} onClick={onCancelar}>
          cancelar
        </button>
        <span className="text-[12px] text-[var(--tinta-3)]">
          A senha aparece uma vez depois de criar. A pessoa troca em Minha conta.
        </span>
      </div>
    </div>
  );
}

function RedefinirSenha({
  pendente,
  onConfirmar,
  onCancelar,
}: {
  pendente: boolean;
  onConfirmar: (senha: string) => void;
  onCancelar: () => void;
}) {
  const [senha, setSenha] = useState(() => senhaTemporaria(sortear));

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-3">
      <span className="text-[12px] text-[var(--tinta-2)]">Nova senha:</span>
      <input className="campo" value={senha} onChange={(e) => setSenha(e.target.value)} />
      <button
        type="button"
        className="btn btn-fantasma"
        onClick={() => setSenha(senhaTemporaria(sortear))}
        title="Sortear outra"
      >
        <Wand2 size={13} aria-hidden />
      </button>
      <button className="btn btn-primario" disabled={pendente} onClick={() => onConfirmar(senha)}>
        {pendente ? <Loader size={13} className="animate-spin" aria-hidden /> : null}
        redefinir e encerrar sessões
      </button>
      <button className="btn btn-fantasma" disabled={pendente} onClick={onCancelar}>
        cancelar
      </button>
    </div>
  );
}
