import Link from "next/link";
import { ArrowUpRight, Inbox } from "lucide-react";
import { nowInAppTz } from "@/lib/dates";
import { clientesComExcedente } from "@/lib/intel/horas";
import { Cabecalho, Faixa, Nota, Painel, Rolante, Secao, Vazio } from "@/components/Cartao";

export const dynamic = "force-dynamic";

/**
 * RADAR — a fila de quem procurar hoje.
 *
 * ⚠ Esta tela responde *"quem eu devo procurar, e por quê?"*, e **nada mais**.
 *
 * Ela já teve uma seção de "Contexto" com receita do ano, top 5 e queda mensal.
 * Eram métricas legítimas — estão na especificação do Diego —, mas **na tela
 * errada**: ocupavam dois terços do Radar e competiam com a fila, que é o
 * produto. Foram para a Carteira, onde receita é atributo do cliente. O dono
 * apontou isso em 2026-08-27: *"a informação de receita não é tão relevante ao
 * propósito da ferramenta"*.
 *
 * O que sobra aqui é a fila, o que ela cobre, e o que ainda não dispara.
 */
export default async function Radar() {
  const agora = nowInAppTz();

  // A fila LANÇA de propósito quando o espelho está incompleto, e o erro vira
  // conteúdo. Devolver lista vazia seria indistinguível de "ninguém tem sinal"
  // — a mentira mais cara que esta tela poderia contar.
  let fila: Awaited<ReturnType<typeof clientesComExcedente>> | null = null;
  let filaBloqueada: string | null = null;
  try {
    fila = await clientesComExcedente(agora);
  } catch (err) {
    filaBloqueada = err instanceof Error ? err.message : String(err);
  }

  const horasFmt = (v: { toFixed: (n: number) => string }) =>
    `${Number(v.toFixed(1))}h`.replace(".", ",");
  const naFila = fila?.itens.length ?? 0;
  const MOSTRAR = 25;

  return (
    <>
      <Cabecalho
        titulo="Radar"
        sub="Quem procurar hoje, e por quê."
        acao={
          naFila > 0 ? (
            <span className="selo selo-critico">
              {naFila} {naFila === 1 ? "cliente na fila" : "clientes na fila"}
            </span>
          ) : null
        }
      />

      <div className="space-y-9">
        <Secao
          titulo="Oportunidades"
          sub="Clientes com sinal de venda adicional, do mais forte para o mais fraco."
        >
          {filaBloqueada ? (
            <Faixa tom="atencao">
              <strong>A fila ainda não pode ser calculada.</strong> {filaBloqueada}
            </Faixa>
          ) : !fila || fila.itens.length === 0 ? (
            <Vazio Icone={Inbox}>
              Nenhum cliente com sinal no momento — sobre {fila?.analisados ?? 0} analisados.
              {fila?.ambiguos ? (
                <>
                  {" "}
                  <span className="text-[var(--atencao-tinta)]">
                    {fila.ambiguos} ficaram de fora por atribuição ambígua
                  </span>{" "}
                  — têm mais de um contrato com cota, e a reserva não diz de qual balde a hora saiu.
                </>
              ) : null}
            </Vazio>
          ) : (
            <Painel
              rodape={
                naFila > MOSTRAR ? (
                  <>
                    Mostrando os {MOSTRAR} sinais mais fortes de {naFila}.
                  </>
                ) : null
              }
            >
              <Rolante>
                <table className="tabela">
                  <thead>
                    <tr>
                      <th>Cliente</th>
                      <th>Motivo</th>
                      <th className="text-right">Horas pagas por fora</th>
                      <th className="text-right">Ciclos</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {fila.itens.slice(0, MOSTRAR).map((i) => (
                      <tr key={i.customerConexaId} className="linha-sinal group">
                        <td>
                          <Link
                            href={`/carteira/${i.customerConexaId}`}
                            className="font-medium hover:text-[var(--acento-tinta)] hover:underline"
                          >
                            {i.nome ?? `Cliente ${i.customerConexaId}`}
                          </Link>
                        </td>
                        <td className="text-[var(--tinta-2)]">
                          Estoura a cota de horas com recorrência — candidato a upgrade
                        </td>
                        <td className="num text-right font-semibold text-[var(--critico-tinta)]">
                          {horasFmt(i.horas.sinal!.horasExcedentes)}
                        </td>
                        <td className="num text-right text-[var(--tinta-2)]">
                          {i.horas.sinal!.ciclosComEstouro}/{i.horas.sinal!.ciclosConclusivos}
                        </td>
                        <td className="pr-3 text-right">
                          <Link
                            href={`/carteira/${i.customerConexaId}`}
                            aria-label={`Abrir ${i.nome ?? i.customerConexaId}`}
                            className="inline-flex text-[var(--tinta-3)] opacity-0 transition-opacity hover:text-[var(--acento-tinta)] group-hover:opacity-100"
                          >
                            <ArrowUpRight size={15} />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Rolante>
            </Painel>
          )}

          {/* A cobertura é parte do sinal: "ninguém na fila" só quer dizer algo
              quando se sabe sobre quantos clientes a conta rodou. */}
          {fila ? (
            <Nota>
              {fila.analisados.toLocaleString("pt-BR")} clientes elegíveis analisados — ativos, não
              bloqueados e com contrato vigente ligado a um plano.
              {fila.ambiguos > 0 ? (
                <>
                  {" "}
                  <strong>{fila.ambiguos}</strong> ficaram de fora por atribuição ambígua: têm mais
                  de um contrato com cota, e a reserva não diz de qual balde a hora saiu.
                </>
              ) : null}
            </Nota>
          ) : null}
        </Secao>

        {/* O detalhamento dos gatilhos vive em tela própria — repetir aqui
            competiria com a fila, que é o produto desta tela. */}
        <Faixa tom="info">
          Só <strong>um gatilho</strong> está ativo hoje. Veja em{" "}
          <Link
            href="/gatilhos"
            className="font-medium text-[var(--acento-tinta)] underline underline-offset-2"
          >
            Gatilhos
          </Link>{" "}
          o que falta para os outros — fila vazia só significa algo quando se sabe o que está ligado.
        </Faixa>
      </div>
    </>
  );
}
