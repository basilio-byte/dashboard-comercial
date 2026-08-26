import { cn } from "@/lib/ui";

/**
 * Selo de procedência. Critério de aceite da Fase 1: **nenhum número na tela
 * sem selo**. Um valor sem origem declarada é indistinguível de um chute, e
 * este sistema gera oferta para cliente real.
 *
 * Discreto de propósito: é metadado, não conteúdo. Compete com o número só
 * quando a procedência é ruim.
 */
const PAPEIS = {
  API: { texto: "da API", classe: "text-[var(--tinta-3)] border-[var(--linha)]" },
  DERIVADO: { texto: "derivado", classe: "text-[var(--tinta-3)] border-[var(--linha)]" },
  MANUAL: { texto: "manual", classe: "text-[var(--atencao-tinta)] border-[color-mix(in_oklab,var(--atencao)_40%,transparent)]" },
  INDISPONIVEL: {
    texto: "indisponível",
    classe: "text-[var(--atencao-tinta)] border-[color-mix(in_oklab,var(--atencao)_40%,transparent)]",
  },
} as const;

export function Procedencia({
  tipo,
  detalhe,
  className,
}: {
  tipo: keyof typeof PAPEIS;
  detalhe?: string;
  className?: string;
}) {
  const p = PAPEIS[tipo];
  return (
    <span
      title={detalhe}
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-px text-[10px] font-medium uppercase tracking-wide",
        p.classe,
        className,
      )}
    >
      {p.texto}
    </span>
  );
}

/**
 * Lacuna declarada. Existe para a UI NUNCA mostrar zero no lugar de "não sei" —
 * é a regra de ouro do projeto, e a diferença entre as duas coisas separa um
 * alerta correto de um alerta inventado.
 */
export function Lacuna({ motivo }: { motivo: string }) {
  return (
    <span className="text-[var(--tinta-3)]" title={motivo}>
      não disponível
    </span>
  );
}
