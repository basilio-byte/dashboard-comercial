"use client";
import { useState, useTransition } from "react";
import { Check, Copy, KeyRound, Loader, Plus } from "lucide-react";
import type { TokenListado } from "@/lib/mcp/tokens";
import { acaoCriarTokenMcp, acaoRevogarTokenMcp } from "@/lib/mcp/token-actions";
import { Faixa } from "@/components/Cartao";
import { cn } from "@/lib/ui";

/**
 * TOKENS PESSOAIS DO MCP.
 *
 * ⚠ O token aparece UMA vez, logo depois de criado. A tela diz isso antes e
 * depois, porque a reação natural a "perdi o token" é procurar um botão de
 * "mostrar de novo" — e ele não existe: o banco só guarda o hash. O caminho é
 * revogar e criar outro.
 */
export function TokensMcp({
  tokens,
  urlMcp,
  ehAdmin,
  ehLeitura,
  meuId,
}: {
  tokens: TokenListado[];
  urlMcp: string;
  ehAdmin: boolean;
  /** Perfil VIEWER: só emite token de leitura. */
  ehLeitura: boolean;
  meuId: string;
}) {
  const [nome, setNome] = useState("");
  const [escopo, setEscopo] = useState<"LEITURA" | "ESCRITA">("LEITURA");
  const [novo, setNovo] = useState<{ token: string; nome: string; escopo: string } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);
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

  const copiar = (texto: string, chave: string) => {
    navigator.clipboard.writeText(texto).then(() => {
      setCopiado(chave);
      setTimeout(() => setCopiado(null), 1800);
    });
  };

  const comando = (token: string) =>
    `claude mcp add --transport http --scope local seahub-comercial ${urlMcp} --header "Authorization: Bearer ${token}" --header "x-mcp-cliente: claude-code"`;

  const ativos = tokens.filter((t) => !t.revogadoEm);
  const revogados = tokens.filter((t) => t.revogadoEm);

  return (
    <div className="space-y-4">
      {erro ? (
        <Faixa tom="critico">
          <strong>Não deu.</strong> {erro}
        </Faixa>
      ) : null}

      {novo ? (
        <div className="rounded-[var(--raio-sm)] border border-[var(--atencao)] bg-[var(--wash-atencao)] px-4 py-3.5">
          <div className="text-[13.5px] font-semibold text-[var(--atencao-tinta)]">
            Copie agora — este token não aparece de novo.
          </div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--tinta-2)]">
            O painel guarda só uma impressão digital dele. Se perder, revogue e crie outro.
          </p>
          <Copiavel
            rotulo={`Token "${novo.nome}" (${novo.escopo === "ESCRITA" ? "leitura e escrita" : "somente leitura"})`}
            texto={novo.token}
            copiado={copiado === "token"}
            onCopiar={() => copiar(novo.token, "token")}
          />
          <Copiavel
            rotulo="Comando para o Claude Code, já com o token"
            texto={comando(novo.token)}
            copiado={copiado === "cmd"}
            onCopiar={() => copiar(comando(novo.token), "cmd")}
          />
          <button className="btn btn-fantasma mt-3" onClick={() => setNovo(null)}>
            Já copiei
          </button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <label className="block min-w-[12rem] flex-1">
          <span className="mb-1 block text-[12.5px] font-medium text-[var(--tinta-2)]">Nome</span>
          <input
            className="campo"
            value={nome}
            maxLength={60}
            placeholder="ex.: Claude Code do notebook"
            onChange={(e) => setNome(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[12.5px] font-medium text-[var(--tinta-2)]">Escopo</span>
          <select
            className="campo w-44"
            value={escopo}
            disabled={ehLeitura}
            onChange={(e) => setEscopo(e.target.value as "LEITURA" | "ESCRITA")}
          >
            <option value="LEITURA">somente leitura</option>
            <option value="ESCRITA">leitura e escrita</option>
          </select>
        </label>
        <button
          className="btn btn-primario"
          disabled={pendente || !nome.trim()}
          onClick={() =>
            rodar(async () => {
              const r = await acaoCriarTokenMcp(nome, ehLeitura ? "LEITURA" : escopo);
              setNovo(r);
              setNome("");
            })
          }
        >
          {pendente ? <Loader size={14} className="animate-spin" aria-hidden /> : <Plus size={14} aria-hidden />}
          Criar token
        </button>
      </div>
      {ehLeitura ? (
        <p className="text-[12px] text-[var(--tinta-3)]">
          Seu perfil é somente leitura, então o token também é — o token nunca tem mais poder que a
          pessoa.
        </p>
      ) : null}

      {ativos.length === 0 && !novo ? (
        <p className="flex items-center gap-2 text-[13px] text-[var(--tinta-3)]">
          <KeyRound size={14} aria-hidden /> Nenhum token ativo.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--linha)] rounded-[var(--raio-sm)] border border-[var(--linha)]">
          {ativos.map((t) => (
            <Linha
              key={t.id}
              t={t}
              mostrarDono={ehAdmin && t.dono.id !== meuId}
              pendente={pendente}
              onRevogar={() => rodar(() => acaoRevogarTokenMcp(t.id))}
            />
          ))}
        </ul>
      )}

      {revogados.length > 0 ? (
        <details className="text-[12.5px] text-[var(--tinta-3)]">
          <summary className="cursor-pointer">{revogados.length} revogado(s)</summary>
          <ul className="mt-2 space-y-1">
            {revogados.map((t) => (
              <li key={t.id} className="num">
                {t.nome} · {t.prefixo}… · revogado em{" "}
                {new Date(t.revogadoEm!).toLocaleDateString("pt-BR")} por {t.revogadoPor ?? "—"}
                {ehAdmin && t.dono.id !== meuId ? ` · de ${t.dono.email}` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function Linha({
  t,
  mostrarDono,
  pendente,
  onRevogar,
}: {
  t: TokenListado;
  mostrarDono: boolean;
  pendente: boolean;
  onRevogar: () => void;
}) {
  const [confirmando, setConfirmando] = useState(false);
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5">
      <KeyRound size={14} className="shrink-0 text-[var(--tinta-3)]" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[14px] font-medium">{t.nome}</span>
          <span className="num selo">{t.prefixo}…</span>
          <span className={cn("selo", t.escopo === "ESCRITA" ? "selo-atencao" : "")}>
            {t.escopo === "ESCRITA" ? "leitura e escrita" : "somente leitura"}
          </span>
          {mostrarDono ? <span className="selo selo-info">{t.dono.email}</span> : null}
        </div>
        <div className="mt-0.5 text-[12px] text-[var(--tinta-3)]">
          criado em {new Date(t.criadoEm).toLocaleDateString("pt-BR")} ·{" "}
          {t.ultimoUsoEm
            ? `último uso ${new Date(t.ultimoUsoEm).toLocaleString("pt-BR")}`
            : "nunca usado"}
        </div>
      </div>
      {confirmando ? (
        <span className="flex items-center gap-2">
          <button className="btn btn-fantasma text-[var(--critico-tinta)]" disabled={pendente} onClick={onRevogar}>
            Confirmar revogação
          </button>
          <button className="btn btn-fantasma" onClick={() => setConfirmando(false)}>
            Cancelar
          </button>
        </span>
      ) : (
        <button className="btn btn-fantasma" onClick={() => setConfirmando(true)}>
          Revogar
        </button>
      )}
    </li>
  );
}

function Copiavel({
  rotulo,
  texto,
  copiado,
  onCopiar,
}: {
  rotulo: string;
  texto: string;
  copiado: boolean;
  onCopiar: () => void;
}) {
  return (
    <div className="mt-3">
      <div className="mb-1 text-[12px] font-medium text-[var(--tinta-2)]">{rotulo}</div>
      <div className="flex items-start gap-2">
        <code className="num block min-w-0 flex-1 break-all rounded-[var(--raio-sm)] border border-[var(--borda)] bg-[var(--superficie)] px-2.5 py-2 text-[12px]">
          {texto}
        </code>
        <button className="btn btn-fantasma shrink-0" onClick={onCopiar} aria-label={`Copiar ${rotulo}`}>
          {copiado ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
          {copiado ? "Copiado" : "Copiar"}
        </button>
      </div>
    </div>
  );
}
