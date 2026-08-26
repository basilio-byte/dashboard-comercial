import { Info, TriangleAlert, CircleAlert, CircleCheck, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/ui";
import { Procedencia } from "./Procedencia";

/**
 * Cabeçalho de página.
 *
 * Título, uma frase que diz o que a tela responde, e o espaço da direita para
 * a ação ou o contador. Toda tela usa este — antes cada página montava o seu,
 * com tamanhos e espaçamentos ligeiramente diferentes, e o conjunto não
 * parecia um sistema só.
 */
export function Cabecalho({
  titulo,
  sub,
  acao,
}: {
  titulo: string;
  sub?: React.ReactNode;
  acao?: React.ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="titulo-pagina">{titulo}</h1>
        {sub ? (
          <p className="mt-1.5 max-w-2xl text-[14px] leading-relaxed text-[var(--tinta-2)]">{sub}</p>
        ) : null}
      </div>
      {acao ? <div className="shrink-0">{acao}</div> : null}
    </div>
  );
}

/** Cabeçalho de seção, com subtítulo opcional. */
export function Secao({
  titulo,
  sub,
  acao,
  children,
  className,
}: {
  titulo: string;
  sub?: React.ReactNode;
  acao?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
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

/**
 * Stat tile.
 *
 * Hierarquia deliberada: **rótulo pequeno → número grande → contexto pequeno**.
 * O número é o que a pessoa veio ver; tudo o mais recua. Sem essa hierarquia,
 * rótulo e valor competem e a tela vira uma parede cinza.
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
  Icone,
  className,
}: {
  rotulo: string;
  valor: string;
  contexto?: React.ReactNode;
  procedencia?: "API" | "DERIVADO" | "MANUAL" | "INDISPONIVEL";
  confiavel?: boolean;
  detalheProcedencia?: string;
  /** Cor semântica do número. Só quando o valor em si tem polaridade. */
  destaque?: "bom" | "critico";
  Icone?: LucideIcon;
  className?: string;
}) {
  const corValor = !confiavel
    ? "text-[var(--tinta-3)] text-[22px]"
    : destaque === "bom"
      ? "text-[var(--bom-tinta)]"
      : destaque === "critico"
        ? "text-[var(--critico-tinta)]"
        : "text-[var(--tinta)]";

  return (
    <div className={cn("cartao flex flex-col px-4 py-3.5", className)}>
      <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-[var(--tinta-2)]">
        {Icone ? <Icone size={13.5} className="shrink-0 text-[var(--tinta-3)]" /> : null}
        {rotulo}
      </div>

      <div
        className={cn(
          "mt-2 text-[27px] font-semibold leading-none tracking-[-0.02em]",
          corValor,
        )}
      >
        {confiavel ? valor : "não disponível"}
      </div>

      <div className="mt-auto flex items-center gap-2 pt-3 text-[11.5px] text-[var(--tinta-3)]">
        <Procedencia tipo={confiavel ? procedencia : "INDISPONIVEL"} detalhe={detalheProcedencia} />
        <span className="truncate">{confiavel ? contexto : "carga incompleta"}</span>
      </div>
    </div>
  );
}

/**
 * Faixa de aviso.
 *
 * ⚠ O ícone não é enfeite: é o segundo canal. A cor sozinha não diz a
 * gravidade para quem não a distingue, e esta tela decide para quem o vendedor
 * liga. Por isso todo tom tem ícone próprio.
 */
const ICONE_FAIXA: Record<string, LucideIcon> = {
  info: Info,
  atencao: TriangleAlert,
  critico: CircleAlert,
  bom: CircleCheck,
};

export function Faixa({
  tom = "info",
  children,
  className,
}: {
  tom?: "info" | "atencao" | "critico" | "bom";
  children: React.ReactNode;
  className?: string;
}) {
  const Icone = ICONE_FAIXA[tom]!;
  return (
    <div className={cn("faixa", `faixa-${tom}`, className)} role={tom === "critico" ? "alert" : undefined}>
      <Icone size={16} className="faixa-icone" aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * Cartão que embrulha uma tabela ou uma lista, com cabeçalho próprio.
 * `sobreposto` remove o respiro interno para a tabela encostar nas bordas.
 */
export function Painel({
  titulo,
  acao,
  rodape,
  children,
  className,
}: {
  titulo?: React.ReactNode;
  acao?: React.ReactNode;
  rodape?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("cartao overflow-hidden", className)}>
      {titulo ? (
        <div className="cartao-topo">
          <div className="min-w-0 text-[13px] font-medium text-[var(--tinta-2)]">{titulo}</div>
          {acao ? <div className="shrink-0">{acao}</div> : null}
        </div>
      ) : null}
      {children}
      {rodape ? (
        <div className="border-t border-[var(--linha)] px-4 py-2.5 text-[12px] text-[var(--tinta-3)]">
          {rodape}
        </div>
      ) : null}
    </div>
  );
}

/** Rolagem horizontal para tabela larga, sem estourar a página. */
export function Rolante({ children }: { children: React.ReactNode }) {
  return <div className="overflow-x-auto">{children}</div>;
}

/** Estado vazio, com o motivo. Nunca uma tela em branco sem explicação. */
export function Vazio({ children, Icone }: { children: React.ReactNode; Icone?: LucideIcon }) {
  return (
    <div className="cartao flex flex-col items-center gap-2.5 px-6 py-9 text-center">
      {Icone ? (
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--superficie-sutil)] text-[var(--tinta-3)]">
          <Icone size={17} />
        </span>
      ) : null}
      <div className="max-w-md text-[13.5px] leading-relaxed text-[var(--tinta-2)]">{children}</div>
    </div>
  );
}

/** Nota de rodapé de seção: a régua do número, em letra pequena. */
export function Nota({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn("text-[12px] leading-relaxed text-[var(--tinta-3)]", className)}>{children}</p>
  );
}
