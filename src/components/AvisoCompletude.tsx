import Link from "next/link";
import { ROTULO_ENTIDADE, type EstadoEspelho } from "@/lib/intel/completude";
import { Faixa } from "./Cartao";

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

  return (
    <Faixa tom="atencao">
      <p>
        <strong>Espelho incompleto.</strong> Ainda faltam dados de: {rotulos}.
      </p>
      {!estado.receitaConfiavel ? (
        <p className="mt-1">
          Os valores de receita <strong>não são confiáveis</strong> e estão marcados como lacuna. Um
          R$ 0,00 aqui significa &quot;ainda não carregado&quot;, <strong>não</strong> &quot;cliente
          sem faturamento&quot;.
        </p>
      ) : null}
      {/* ⚠ Não manda ninguém "continuar a carga". Ela é automática — o
          agendador embutido roda sozinho —, e o botão que este texto sugeria é
          restrito a administrador: a maioria de quem lê o aviso não pode agir
          sobre ele. Instrução impossível de cumprir treina a pessoa a ignorar o
          aviso inteiro. */}
      <p className="mt-1.5 text-[13.5px] text-[var(--tinta-3)]">
        A carga roda sozinha e retoma de onde parou. Acompanhe em{" "}
        <Link href="/motor" className="font-medium text-[var(--acento-tinta)] hover:underline">
          Motor
        </Link>
        .
      </p>
    </Faixa>
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
