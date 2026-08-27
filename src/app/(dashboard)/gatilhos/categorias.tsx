import { classificacaoDeCategorias } from "@/lib/regras/avaliar";
import { Faixa, Nota, Painel, Rolante, Secao } from "@/components/Cartao";
import { cn } from "@/lib/ui";

/**
 * Como cada categoria de serviço do Conexa está sendo classificada.
 *
 * ⚠ Existe para tornar VISÍVEL uma falha que seria silenciosa. As regras 1, 6,
 * 7, 8 e 10 dependem de casar o nome da categoria; se a Seahub renomear "Salas
 * Privativas - Seaway Center", as três regras de marco de privativa param de
 * encontrar contrato — sem erro, sem alerta, sem nada na tela. Só uma fila que
 * encolhe e ninguém sabe por quê.
 *
 * O projeto irmão em produção tem esse tipo de defeito registrado (ADR-0017 de
 * lá): duas grafias da mesma categoria convivendo, uma com espaço duplo,
 * partindo a receita em duas no relatório que agrupa por string exata — achado
 * por acaso, meses depois, enquanto alguém implementava outra coisa.
 */
export async function CategoriasClassificadas() {
  const cats = await classificacaoDeCategorias();
  const emUso = cats.filter((c) => c.planos > 0);
  const classificadas = emUso.filter((c) => c.privativa || c.fiscal || c.seabox);
  const orfas = emUso.filter((c) => !c.privativa && !c.fiscal && !c.seabox);

  return (
    <Secao
      titulo="Como as categorias são lidas"
      sub="As regras de marco e de segmento casam pelo nome da categoria de serviço. Isto mostra o resultado desse casamento."
      acao={
        <span className={cn("selo", classificadas.length > 0 ? "selo-info" : "selo-atencao")}>
          {classificadas.length} de {emUso.length} classificadas
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

      <Painel
        rodape={
          <>
            Só aparecem categorias <strong>com plano associado</strong> — as demais não podem
            classificar contrato. Um contrato numa categoria não reconhecida simplesmente não
            aciona as regras de marco, e isso não é erro: é o sistema recusando adivinhar.
          </>
        }
      >
        <Rolante>
          <table className="tabela">
            <thead>
              <tr>
                <th>Categoria</th>
                <th className="text-right">Planos</th>
                <th>Lida como</th>
                <th>Destrava</th>
              </tr>
            </thead>
            <tbody>
              {[...classificadas, ...orfas].map((c) => (
                <tr key={c.conexaId}>
                  <td>
                    {/* ⚠ `whitespace-pre` de propósito: espaço duplo no nome é
                        exatamente o defeito do ADR-0017 do irmão, e escondê-lo
                        no HTML seria apagar a evidência. */}
                    <span className="whitespace-pre font-medium">{c.nome}</span>
                    <span className="num selo ml-2">#{c.conexaId}</span>
                  </td>
                  <td className="num text-right text-[var(--tinta-2)]">{c.planos}</td>
                  <td>
                    {c.privativa ? (
                      <span className="selo selo-info">sala privativa</span>
                    ) : c.fiscal ? (
                      <span className="selo selo-info">endereço fiscal</span>
                    ) : c.seabox ? (
                      <span className="selo selo-bom">SeaBox</span>
                    ) : (
                      <span className="text-[var(--tinta-3)]">— não classificada</span>
                    )}
                  </td>
                  <td className="text-[13px] text-[var(--tinta-3)]">
                    {c.privativa
                      ? "regras 6, 7 e 8"
                      : c.fiscal
                        ? "regras 1 e 10"
                        : c.seabox
                          ? "supressão das regras 5 e 7"
                          : "nenhuma"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Rolante>
      </Painel>

      <Nota>
        O casamento é por <strong>trecho do nome</strong> (&quot;privativ&quot;, &quot;fiscal&quot;,
        &quot;seabox&quot;), sem acento e sem caixa — então grafia divergente e espaço duplo não
        quebram. <strong>Renomear a categoria quebra</strong>, e é por isso que esta lista existe:
        para a quebra aparecer aqui em vez de virar uma fila que encolhe sem explicação.
      </Nota>
    </Secao>
  );
}
