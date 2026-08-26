import { cn } from "@/lib/ui";
import { Procedencia } from "./Procedencia";

/**
 * Stat tile.
 *
 * Hierarquia deliberada: **rótulo pequeno → número grande → contexto pequeno**.
 * O número é o que a pessoa veio ver; tudo o mais recua. Sem essa hierarquia,
 * rótulo e valor competem e a tela vira uma parede cinza — que foi exatamente
 * a reclamação sobre a primeira versão.
 *
 * `confiavel: false` troca o número pela lacuna. Nunca mostra zero no lugar de
 * "ainda não sei".
 */
export function Cartao({
  rotulo,
  valor,
  contexto,
  procedencia = "DERIVADO",
  confiavel = true,
  detalheProcedencia,
  destaque,
  className,
}: {
  rotulo: string;
  valor: string;
  contexto?: string;
  procedencia?: "API" | "DERIVADO" | "MANUAL" | "INDISPONIVEL";
  confiavel?: boolean;
  detalheProcedencia?: string;
  /** Cor semântica do número. Só quando o valor em si tem polaridade. */
  destaque?: "bom" | "critico";
  className?: string;
}) {
  const corValor = !confiavel
    ? "text-[var(--tinta-3)]"
    : destaque === "bom"
      ? "text-[var(--bom-tinta)]"
      : destaque === "critico"
        ? "text-[var(--critico-tinta)]"
        : "text-[var(--tinta)]";

  return (
    <div className={cn("cartao px-4 py-3.5", className)}>
      <div className="text-[13px] text-[var(--tinta-2)]">{rotulo}</div>

      <div className={cn("mt-1.5 text-[26px] font-semibold leading-none tracking-tight", corValor)}>
        {confiavel ? valor : "não disponível"}
      </div>

      <div className="mt-2.5 flex items-center gap-2 text-xs text-[var(--tinta-3)]">
        <Procedencia
          tipo={confiavel ? procedencia : "INDISPONIVEL"}
          detalhe={detalheProcedencia}
        />
        <span className="truncate">{confiavel ? contexto : "carga incompleta"}</span>
      </div>
    </div>
  );
}

/** Cabeçalho de seção, com subtítulo opcional. */
export function Secao({
  titulo,
  sub,
  acao,
  children,
}: {
  titulo: string;
  sub?: string;
  acao?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="titulo-secao">{titulo}</h2>
          {sub ? <p className="mt-1 text-[13px] text-[var(--tinta-2)]">{sub}</p> : null}
        </div>
        {acao}
      </div>
      {children}
    </section>
  );
}

/** Estado vazio, com o motivo. Nunca uma tela em branco sem explicação. */
export function Vazio({ children }: { children: React.ReactNode }) {
  return (
    <div className="cartao px-4 py-6 text-center text-sm text-[var(--tinta-2)]">{children}</div>
  );
}
