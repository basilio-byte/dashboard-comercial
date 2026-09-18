import Link from "next/link";
import { ArrowUpRight, Ban, Inbox, PowerOff } from "lucide-react";
import { filaDeSinais, type ClienteNaFila } from "@/lib/regras/fila";
import { carregarGatilhos } from "@/lib/regras/config";
import { formatBRL } from "@/lib/money";
import { Cabecalho, Faixa, Nota, Painel, Rolante, Secao, Vazio } from "@/components/Cartao";
import { cn } from "@/lib/ui";
import { FiltrosDoRadar } from "./filtros-radar";

export const dynamic = "force-dynamic";

/**
 * RADAR — a fila de quem procurar hoje.
 *
 * ⚠ Esta tela responde *"quem eu devo procurar, e por quê?"*, e **nada mais**.
 * Ela já teve uma seção de receita do ano e top 5; eram métricas legítimas na
 * tela errada, e foram para a Carteira, onde receita é atributo do cliente.
 *
 * ⚠ **Até 2026-09-16 ela mostrava UM gatilho de doze.** O Radar consumia só a
 * fila de excedente de horas; as outras onze regras eram avaliadas apenas
 * abrindo cliente por cliente, e `fila.ts` — que avalia todas em lote — estava
 * escrita sem nenhum consumidor.
 *
 * O efeito medido disso: numa amostra de 10 clientes, **6 tinham sinal ativo**.
 * Com milhares de clientes, um sinal que exige abrir a ficha é o mesmo que não
 * existir. A pergunta do dono, *"por que os gatilhos não estão ligados?"*, tinha
 * como resposta que estavam — e o produto escondia.
 *
 * O pedido do Diego, *"aumentar o número de oportunidades levando em
 * consideração os gatilhos existentes"*, é exatamente isto: não faltava gatilho,
 * faltava a tela mostrar os que já existiam.
 */
export default async function Radar({
  searchParams,
}: {
  searchParams: Promise<{ regra?: string; dias?: string; receita?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const regrasPedidas = (sp.regra ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const diasSemContato = sp.dias ? Number(sp.dias) : undefined;
  const receitaMin = sp.receita ? Number(sp.receita) : undefined;
  const busca = (sp.q ?? "").trim().toLowerCase();

  const [fila, gatilhos] = await Promise.all([filaDeSinais(), carregarGatilhos()]);

  let clientes = fila.clientes;
  if (regrasPedidas.length) {
    const set = new Set(regrasPedidas);
    clientes = clientes
      .map((c) => ({ ...c, sinais: c.sinais.filter((s) => set.has(s.regra)) }))
      .filter((c) => c.sinais.length > 0);
  }
  if (diasSemContato !== undefined && !Number.isNaN(diasSemContato)) {
    const corte = Date.now() - diasSemContato * 86_400_000;
    clientes = clientes.filter(
      (c) => !c.ultimoContato || c.ultimoContato.contatoEm.getTime() < corte,
    );
  }
  if (receitaMin !== undefined && !Number.isNaN(receitaMin)) {
    clientes = clientes.filter((c) => c.receitaAno >= receitaMin);
  }
  if (busca) {
    clientes = clientes.filter((c) => (c.nome ?? "").toLowerCase().includes(busca));
  }

  const MOSTRAR = 60;
  const naFila = clientes.length;
  const temFiltro = regrasPedidas.length > 0 || diasSemContato !== undefined || receitaMin !== undefined || !!busca;

  // Só gatilhos que produziram alguém — filtrar por uma regra de fila vazia é
  // um clique que não leva a lugar nenhum.
  const opcoesDeRegra = gatilhos.todos
    .filter((g) => (fila.porRegra[g.codigo] ?? 0) > 0)
    .map((g) => ({ codigo: g.codigo, nome: g.nome, quantos: fila.porRegra[g.codigo] ?? 0 }));

  return (
    <>
      <Cabecalho
        titulo="Radar"
        sub="Quem procurar hoje, e por quê. Todos os gatilhos ligados, avaliados sobre a base elegível inteira."
        acao={
          naFila > 0 ? (
            <span className="selo selo-critico">
              {naFila.toLocaleString("pt-BR")} {naFila === 1 ? "cliente na fila" : "clientes na fila"}
            </span>
          ) : null
        }
      />

      <div className="space-y-8">
        <FiltrosDoRadar
          regras={opcoesDeRegra}
          selecionadas={regrasPedidas}
          dias={sp.dias ?? ""}
          receita={sp.receita ?? ""}
          q={sp.q ?? ""}
          totalDeSinais={fila.itens.length}
        />

        <Secao
          titulo="Oportunidades"
          sub="Do sinal mais forte para o mais fraco. Um cliente pode aparecer com mais de um motivo."
        >
          {clientes.length === 0 ? (
            <Vazio Icone={Inbox}>
              {temFiltro ? (
                <>
                  Nenhum cliente com esses filtros — de{" "}
                  <strong>{fila.clientes.length.toLocaleString("pt-BR")}</strong> na fila.
                </>
              ) : (
                <>
                  Nenhum cliente com sinal, sobre{" "}
                  {fila.analisados.toLocaleString("pt-BR")} analisados por{" "}
                  {fila.avaliados} {fila.avaliados === 1 ? "gatilho" : "gatilhos"}.
                </>
              )}
            </Vazio>
          ) : (
            <Painel
              rodape={
                naFila > MOSTRAR ? (
                  <>
                    Mostrando os {MOSTRAR} sinais mais fortes de {naFila.toLocaleString("pt-BR")}.
                    Use os filtros acima para cortar a fila por motivo.
                  </>
                ) : null
              }
            >
              <Rolante>
                <table className="tabela">
                  <thead>
                    <tr>
                      <th>Cliente</th>
                      <th>Por quê</th>
                      <th className="text-right">Receita no ano</th>
                      {/* Sugestão do Diego: sem isto a fila mostra o mesmo
                          cliente todo dia, inclusive para quem já ligou ontem. */}
                      <th>Último contato</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {clientes.slice(0, MOSTRAR).map((c) => (
                      <Linha key={c.customerConexaId} cliente={c} />
                    ))}
                  </tbody>
                </table>
              </Rolante>
            </Painel>
          )}

          {/* A cobertura é parte do sinal: "ninguém na fila" só quer dizer algo
              quando se sabe sobre quantos clientes e por quantos gatilhos a
              conta rodou. */}
          <Nota>
            {fila.analisados.toLocaleString("pt-BR")} clientes elegíveis analisados — ativos, não
            bloqueados e com contrato vigente ligado a um plano — por{" "}
            <strong>
              {fila.avaliados} {fila.avaliados === 1 ? "gatilho" : "gatilhos"}
            </strong>
            , gerando {fila.itens.length.toLocaleString("pt-BR")} sinais em{" "}
            {fila.clientes.length.toLocaleString("pt-BR")} clientes.
            {fila.semContratoAnalisados > 0 ? (
              <>
                {" "}
                Mais {fila.semContratoAnalisados} que perderam o contrato recentemente, olhados à parte
                — eles já não fazem parte da base com contrato.
              </>
            ) : null}
            {fila.suspensosPeloFreio > 0 ? (
              <>
                {" "}
                <strong>
                  {fila.suspensosPeloFreio}{" "}
                  {fila.suspensosPeloFreio === 1 ? "oferta de venda suspensa" : "ofertas de venda suspensas"}
                </strong>{" "}
                pelo freio de cobrança em atraso — o motivo aparece na ficha de cada cliente.
              </>
            ) : null}
          </Nota>
        </Secao>

        {(fila.bloqueadas.length > 0 || fila.desligadas.length > 0) && (
          <Secao
            titulo="O que não entrou nesta conta"
            sub="Fila vazia só é interpretável quando se sabe o que não foi avaliado — e de quem é a próxima ação."
          >
            <div className="grid gap-3 md:grid-cols-2">
              {fila.bloqueadas.length > 0 ? (
                <Painel titulo={<><Ban size={13} className="mr-1.5 inline" aria-hidden />Bloqueados</>}>
                  <ul className="divide-y divide-[var(--linha)]">
                    {fila.bloqueadas.map((b) => (
                      <li key={b.regra} className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="num selo">{b.regra}</span>
                          <span className="text-[13.5px] font-medium">{b.nome}</span>
                        </div>
                        <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--tinta-3)]">
                          {b.motivo}
                        </p>
                      </li>
                    ))}
                  </ul>
                </Painel>
              ) : null}

              {fila.desligadas.length > 0 ? (
                <Painel
                  titulo={<><PowerOff size={13} className="mr-1.5 inline" aria-hidden />Desligados</>}
                  rodape={
                    <>
                      Alguém desligou na tela{" "}
                      <Link href="/gatilhos" className="font-medium text-[var(--acento-tinta)] underline underline-offset-2">
                        Gatilhos
                      </Link>{" "}
                      — e religa lá. Não é conclusão sobre cliente nenhum.
                    </>
                  }
                >
                  <ul className="divide-y divide-[var(--linha)]">
                    {fila.desligadas.map((d) => (
                      <li key={d.regra} className="flex items-center gap-2 px-4 py-2.5">
                        <span className="num selo">{d.regra}</span>
                        <span className="text-[13.5px]">{d.nome}</span>
                      </li>
                    ))}
                  </ul>
                </Painel>
              ) : null}
            </div>
          </Secao>
        )}

        <Faixa tom="info">
          <strong>Nada aqui cria task em lugar nenhum.</strong> A camada de disparo não existe — o
          Radar aponta, e a abordagem é sempre de uma pessoa. Registre o contato na ficha do
          cliente para o mesmo nome não voltar amanhã.
        </Faixa>
      </div>
    </>
  );
}

function Linha({ cliente: c }: { cliente: ClienteNaFila }) {
  const principal = c.sinais[0]!;
  return (
    <tr className="linha-sinal group">
      <td>
        <Link
          href={`/carteira/${c.customerConexaId}`}
          className="font-medium hover:text-[var(--acento-tinta)] hover:underline"
        >
          {c.nome ?? `Cliente ${c.customerConexaId}`}
        </Link>
        {c.segmentos.length ? (
          <div className="mt-0.5 text-[12px] text-[var(--tinta-3)]">{c.segmentos.join(", ")}</div>
        ) : null}
      </td>

      <td className="max-w-lg">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="selo selo-critico">{principal.nomeDaRegra}</span>
          <span className="text-[13px] text-[var(--tinta-2)]">{principal.evidencia}</span>
          {c.sinais.length > 1 ? (
            <span
              className="selo"
              title={c.sinais
                .slice(1)
                .map((s) => `${s.nomeDaRegra} — ${s.evidencia}`)
                .join("\n")}
            >
              +{c.sinais.length - 1} {c.sinais.length === 2 ? "motivo" : "motivos"}
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 text-[12.5px] text-[var(--tinta-3)]">ofertar: {principal.oferta}</div>
      </td>

      <td className="num text-right">{formatBRL(c.receitaAno)}</td>

      <td className="whitespace-nowrap">
        {c.ultimoContato ? (
          <span
            className={cn(
              "selo",
              c.ultimoContato.resultado === "RECUSOU" && "selo-critico",
              c.ultimoContato.resultado === "FECHOU" && "selo-bom",
            )}
            title={`${c.ultimoContato.quem} · ${c.ultimoContato.resultado.toLowerCase().replace("_", " ")}`}
          >
            {diasDesde(c.ultimoContato.contatoEm)} · {c.ultimoContato.quem}
          </span>
        ) : (
          <span className="text-[var(--tinta-3)]">nunca</span>
        )}
      </td>

      <td className="pr-3 text-right">
        <Link
          href={`/carteira/${c.customerConexaId}`}
          aria-label={`Abrir ${c.nome ?? c.customerConexaId}`}
          className="inline-flex text-[var(--tinta-3)] opacity-0 transition-opacity hover:text-[var(--acento-tinta)] group-hover:opacity-100"
        >
          <ArrowUpRight size={15} />
        </Link>
      </td>
    </tr>
  );
}

/** "hoje", "3 dias", "2 meses" — o vendedor lê distância, não data. */
function diasDesde(d: Date): string {
  const n = Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
  if (n === 0) return "hoje";
  if (n === 1) return "1 dia";
  if (n < 60) return `${n} dias`;
  return `${Math.floor(n / 30)} meses`;
}
