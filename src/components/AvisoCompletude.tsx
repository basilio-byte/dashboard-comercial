import { ROTULO_ENTIDADE, type EstadoEspelho } from "@/lib/intel/completude";

/**
 * Aviso de espelho incompleto.
 *
 * Aparece SEMPRE que alguma fonte de um número da tela não terminou de
 * carregar. Sem ele, um perfil com receita R$ 0,00 porque as cobranças não
 * foram carregadas é visualmente idêntico a um cliente que de fato não faturou
 * — e foi exatamente isso que aconteceu na primeira carga real.
 */
export function AvisoCompletude({ estado }: { estado: EstadoEspelho }) {
  if (estado.incompletas.length === 0) return null;

  const rotulos = estado.incompletas.map((e) => ROTULO_ENTIDADE[e]).join(", ");
  const receitaAfetada = !estado.receitaConfiavel;

  return (
    <div className="rounded border border-[color-mix(in_oklab,var(--atencao)_35%,transparent)] bg-[var(--wash-atencao)] px-4 py-3 text-sm text-[var(--atencao-tinta)]">
      <p>
        <strong>Espelho incompleto.</strong> Ainda faltam dados de: {rotulos}.
      </p>
      {receitaAfetada ? (
        <p className="mt-1">
          Os valores de receita <strong>não são confiáveis</strong> e estão marcados como lacuna. Um
          R$ 0,00 aqui significa &quot;ainda não carregado&quot;, <strong>não</strong> &quot;cliente sem
          faturamento&quot;.
        </p>
      ) : null}
      <p className="mt-1 text-xs">
        Continue a carga em Motor — ela retoma de onde parou, não recomeça.
      </p>
    </div>
  );
}

/** Valor monetário que respeita a completude: mostra lacuna em vez de zero falso. */
export function ValorOuLacuna({
  valor,
  confiavel,
  className,
}: {
  valor: string;
  confiavel: boolean;
  className?: string;
}) {
  if (confiavel) return <span className={className}>{valor}</span>;
  return (
    <span
      className={`text-[var(--tinta-3)] ${className ?? ""}`}
      title="A carga de cobranças não terminou — este número seria um zero falso"
    >
      não disponível
    </span>
  );
}
