import {
  lerCategorias,
  REGRAS_DO_SEGMENTO,
  ROTULO_SEGMENTO,
  SEGMENTOS,
} from "@/lib/regras/segmentos";
import { Faixa, Nota, Secao } from "@/components/Cartao";
import { cn } from "@/lib/ui";
import { EditorDeCategorias } from "./categorias-editor";

/**
 * Como cada categoria de serviço do Conexa é lida — e onde se corrige.
 *
 * ⚠ Existe para tornar VISÍVEL uma falha que seria silenciosa. As regras 1, 6,
 * 7, 8 e 10 dependem de reconhecer o segmento da categoria; se a Seahub
 * renomear "Salas Privativas - Seaway Center", as três regras de marco de
 * privativa param de encontrar contrato — sem erro, sem alerta, sem nada na
 * tela. Só uma fila que encolhe e ninguém sabe por quê.
 *
 * O projeto irmão em produção tem esse tipo de defeito registrado (ADR-0017 de
 * lá): duas grafias da mesma categoria convivendo, uma com espaço duplo,
 * partindo a receita em duas no relatório que agrupa por string exata — achado
 * por acaso, meses depois, enquanto alguém implementava outra coisa.
 *
 * ⚠ **Desde 2026-09-16 dá para classificar à mão**, que é o pedido do Diego
 * ("Meu Depósito", "Serviços de Espaço - Ayrton Senna"...). E isso não é só
 * conveniência: a classificação manual é **por id**, e id não muda quando o
 * nome muda. Classificar uma categoria é o que faz renomear deixar de quebrar.
 */
export async function CategoriasClassificadas({ podeEditar }: { podeEditar: boolean }) {
  const cats = await lerCategorias();
  const emUso = cats.filter((c) => c.planos > 0);
  const classificadas = emUso.filter((c) => c.segmento !== null);
  const manuais = emUso.filter((c) => c.origem === "MANUAL");
  const orfas = emUso.filter((c) => c.segmento === null);
  // Divergência entre o que alguém declarou e o que o nome sugere. Ou o Conexa
  // renomeou, ou a classificação está errada — os dois merecem olhada.
  const divergentes = manuais.filter(
    (c) => c.sugestaoPeloNome !== null && c.sugestaoPeloNome !== c.segmento,
  );

  return (
    <Secao
      titulo="Como as categorias são lidas"
      sub="As regras de marco e de segmento dependem de reconhecer a categoria de serviço do plano. Isto mostra — e corrige — esse reconhecimento."
      acao={
        <span className={cn("selo", classificadas.length > 0 ? "selo-info" : "selo-atencao")}>
          {classificadas.length} de {emUso.length} reconhecidas · {manuais.length} à mão
        </span>
      }
    >
      {classificadas.length === 0 && emUso.length > 0 ? (
        <Faixa tom="critico">
          <strong>Nenhuma categoria foi reconhecida.</strong> As regras 1, 6, 7, 8 e 10 não vão
          encontrar contrato nenhum. Ou o catálogo mudou de nome, ou os cadastros não foram
          carregados.
        </Faixa>
      ) : null}

      {divergentes.length > 0 ? (
        <Faixa tom="atencao">
          <strong>
            {divergentes.length}{" "}
            {divergentes.length === 1 ? "categoria classificada diverge" : "categorias classificadas divergem"}{" "}
            do que o nome sugere.
          </strong>{" "}
          Ou o Conexa renomeou a categoria, ou a classificação está errada. As duas hipóteses
          valem uma olhada:{" "}
          {divergentes.map((c) => c.nome).join(", ")}.
        </Faixa>
      ) : null}

      {orfas.length > 0 ? (
        <Faixa tom="info">
          <strong>
            {orfas.length} {orfas.length === 1 ? "categoria em uso não é reconhecida" : "categorias em uso não são reconhecidas"}
          </strong>{" "}
          — contratos nelas não acionam regra de segmento. Isso não é erro: é o sistema recusando
          adivinhar. Classifique-as abaixo para que passem a acionar, ou marque como{" "}
          <strong>ignorar</strong> para registrar que foram olhadas.
        </Faixa>
      ) : null}

      <EditorDeCategorias
        categorias={cats}
        segmentos={SEGMENTOS}
        rotulos={ROTULO_SEGMENTO}
        destrava={REGRAS_DO_SEGMENTO}
        podeEditar={podeEditar}
      />

      <Nota>
        Sem classificação manual, o reconhecimento é por <strong>trecho do nome</strong>
        (&quot;privativ&quot;, &quot;fiscal&quot;, &quot;seabox&quot;), sem acento e sem caixa —
        então grafia divergente e espaço duplo não quebram, mas <strong>renomear quebra</strong>.
        A classificação manual é por <strong>id</strong> e sobrevive à renomeação; ela vence a
        heurística sempre. <strong>Ignorar</strong> é uma resposta (&quot;olhamos, não
        interessa&quot;) e é diferente de não classificar, que é ausência de resposta.
      </Nota>
    </Secao>
  );
}
