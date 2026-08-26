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
  API: { texto: "da API", classe: "" },
  DERIVADO: { texto: "derivado", classe: "" },
  MANUAL: { texto: "manual", classe: "selo-atencao" },
  INDISPONIVEL: { texto: "indisponível", classe: "selo-atencao" },
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
    <span title={detalhe} className={cn("selo", p.classe, className)}>
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
