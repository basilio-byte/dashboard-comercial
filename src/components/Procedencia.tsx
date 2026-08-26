import { cn } from "@/lib/ui";

/**
 * Selo de procedência. Critério de aceite da Fase 1: **nenhum número na tela
 * sem selo**. Um valor sem origem declarada é indistinguível de um chute, e
 * este sistema vai gerar oferta para cliente real.
 */
const ROTULOS = {
  API: { texto: "da API", classe: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
  DERIVADO: { texto: "derivado", classe: "bg-sky-50 text-sky-800 ring-sky-200" },
  MANUAL: { texto: "manual", classe: "bg-amber-50 text-amber-900 ring-amber-200" },
  INDISPONIVEL: { texto: "indisponível", classe: "bg-neutral-100 text-neutral-600 ring-neutral-300" },
} as const;

export function Procedencia({
  tipo,
  detalhe,
  className,
}: {
  tipo: keyof typeof ROTULOS;
  detalhe?: string;
  className?: string;
}) {
  const r = ROTULOS[tipo];
  return (
    <span
      title={detalhe}
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ring-1 ring-inset",
        r.classe,
        className,
      )}
    >
      {r.texto}
    </span>
  );
}

/**
 * Lacuna declarada. Existe para a UI NUNCA mostrar zero no lugar de "não sei" —
 * é a regra de ouro do projeto, e a diferença entre as duas coisas é o que
 * separa um alerta correto de um alerta inventado.
 */
export function Lacuna({ motivo }: { motivo: string }) {
  return (
    <span className="text-neutral-400" title={motivo}>
      não disponível
    </span>
  );
}
