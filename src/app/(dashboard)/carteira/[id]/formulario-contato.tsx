"use client";
import { useActionState, useState } from "react";
import { CircleAlert, CircleCheck, Plus, X } from "lucide-react";
import { registrarContato, type EstadoContato } from "@/lib/operacao/contatos";

/** Rótulo e cor de cada resultado. Compartilhado com a tabela do histórico. */
export const RESULTADO_ESTILO: Record<string, { rotulo: string; classe: string }> = {
  FALOU: { rotulo: "falou", classe: "" },
  SEM_RESPOSTA: { rotulo: "sem resposta", classe: "selo-atencao" },
  INTERESSADO: { rotulo: "interessado", classe: "selo-info" },
  RECUSOU: { rotulo: "recusou", classe: "selo-critico" },
  FECHOU: { rotulo: "fechou", classe: "selo-bom" },
};

const REGRAS = [
  { v: "", r: "— sem regra específica" },
  { v: "extra", r: "extra · estoura a cota de horas" },
  { v: "1", r: "regra 1 · Fiscal 11 meses" },
  { v: "3", r: "regra 3 · padrão irregular" },
  { v: "4", r: "regra 4 · avulso com uso alto" },
  { v: "5", r: "regra 5 · primeira reserva" },
  { v: "6", r: "regra 6 · privativa 1 mês" },
  { v: "7", r: "regra 7 · privativa 2 meses" },
  { v: "8", r: "regra 8 · privativa 6 meses" },
  { v: "10", r: "regra 10 · Litoral reserva sala" },
  { v: "métrica", r: "métrica · queda de receita" },
];

/**
 * Registro de contato.
 *
 * ⚠ Fica fechado por padrão. Esta tela é para LER o cliente antes de ligar; o
 * formulário aberto o tempo todo empurraria o que importa para baixo da dobra.
 */
export function FormularioContato({ customerConexaId }: { customerConexaId: number }) {
  const [aberto, setAberto] = useState(false);
  const [estado, acao, pendente] = useActionState<EstadoContato, FormData>(registrarContato, {});

  // Fecha sozinho quando dá certo — a confirmação vira a linha nova na tabela.
  if (estado.ok && aberto) setTimeout(() => setAberto(false), 0);

  if (!aberto) {
    return (
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => setAberto(true)} className="btn">
          <Plus size={14} aria-hidden />
          Registrar contato
        </button>
        {estado.ok ? (
          <span className="flex items-center gap-1.5 text-[13px] text-[var(--bom-tinta)]">
            <CircleCheck size={14} aria-hidden />
            {estado.ok}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <form action={acao} className="cartao space-y-3.5 px-4 py-4">
      <input type="hidden" name="customerConexaId" value={customerConexaId} />

      <div className="flex items-center justify-between">
        <span className="text-[14px] font-semibold">Registrar contato</span>
        <button
          type="button"
          onClick={() => setAberto(false)}
          aria-label="Fechar"
          className="btn btn-fantasma h-7 w-7 p-0"
        >
          <X size={14} />
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Campo rotulo="Quem falou">
          <input
            name="quem"
            required
            maxLength={80}
            placeholder="nome do vendedor"
            className="campo"
          />
        </Campo>

        <Campo rotulo="Quando">
          {/* Default hoje. Data no futuro é recusada no servidor. */}
          <input
            name="contatoEm"
            type="date"
            defaultValue={new Date().toISOString().slice(0, 10)}
            className="campo"
          />
        </Campo>

        <Campo rotulo="Resultado">
          <select name="resultado" required defaultValue="FALOU" className="campo">
            {Object.entries(RESULTADO_ESTILO).map(([v, { rotulo }]) => (
              <option key={v} value={v}>
                {rotulo}
              </option>
            ))}
          </select>
        </Campo>

        <Campo rotulo="Motivou por">
          <select name="regra" defaultValue="" className="campo">
            {REGRAS.map((r) => (
              <option key={r.v} value={r.v}>
                {r.r}
              </option>
            ))}
          </select>
        </Campo>
      </div>

      <Campo rotulo="Nota (opcional)">
        <input
          name="nota"
          maxLength={300}
          placeholder="o que ficou combinado"
          className="campo"
        />
      </Campo>

      {estado.erro ? (
        <div role="alert" className="faixa faixa-critico">
          <CircleAlert size={16} className="faixa-icone" aria-hidden />
          <div className="min-w-0 flex-1">{estado.erro}</div>
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <button type="submit" disabled={pendente} className="btn btn-primario">
          {pendente ? "Registrando…" : "Registrar"}
        </button>
        <span className="text-[12.5px] text-[var(--tinta-3)]">
          Fica no histórico deste cliente. Nada é enviado a ninguém.
        </span>
      </div>
    </form>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12.5px] font-medium text-[var(--tinta-2)]">{rotulo}</span>
      {children}
    </label>
  );
}
