import Link from "next/link";
import { ArrowUpRight, Users, Wallet, Trophy, TrendingDown, Inbox } from "lucide-react";
import { prisma } from "@/lib/db";
import { formatBRL, money } from "@/lib/money";
import { nowInAppTz, rotuloMes, ultimoMesFechado } from "@/lib/dates";
import { participacao, topClientes } from "@/lib/metrics/receita";
import { estadoDoEspelho } from "@/lib/intel/completude";
import { clientesComExcedente } from "@/lib/intel/horas";
import { Cabecalho, Cartao, Faixa, Painel, Rolante, Secao, Vazio } from "@/components/Cartao";
import { Procedencia } from "@/components/Procedencia";
import { corVariacao, pct } from "@/lib/ui";

export const dynamic = "force-dynamic";

/**
 * RADAR — a fila de quem procurar hoje.
 *
 * ⚠ Esta tela responde *"quem eu devo procurar, e por quê?"*, **não** "quanto
 * faturamos". A segunda é a pergunta do dashboard financeiro; copiá-la aqui
 * transformaria um motor de oportunidades num relatório que ninguém abre.
 *
 * Daí a ordem: oportunidades primeiro; logo abaixo, o que o motor consegue e o
 * que não consegue — para uma fila vazia nunca ser ambígua; e a carteira por
 * último, como contexto para a conversa, não como manchete.
 */
export default async function Radar() {
  const agora = nowInAppTz();
  const anoCorrente = agora.getFullYear();
  const mesFechado = ultimoMesFechado(agora);

  const [espelho, agregado, clientesAtivos] = await Promise.all([
    estadoDoEspelho(),
    prisma.customerProfile.aggregate({
      where: { receitaAnoCorrente: { gt: 0 } },
      _sum: { receitaAnoCorrente: true },
      _count: true,
    }),
    prisma.customer.count({ where: { isActive: true, isBlocked: false } }),
  ]);

  // A fila LANÇA de propósito quando o espelho está incompleto, e o erro vira
  // conteúdo. Devolver lista vazia seria indistinguível de "ninguém tem sinal"
  // — a mentira mais cara que esta tela poderia contar.
  let fila: Awaited<ReturnType<typeof clientesComExcedente>> | null = null;
  let filaBloqueada: string | null = null;
  try {
    fila = await clientesComExcedente(agora, { limite: 200 });
  } catch (err) {
    filaBloqueada = err instanceof Error ? err.message : String(err);
  }

  const totalAno = money(agregado._sum.receitaAnoCorrente?.toString() ?? 0);
  const horasFmt = (v: { toFixed: (n: number) => string }) =>
    `${Number(v.toFixed(1))}h`.replace(".", ",");
  const naFila = fila?.itens.length ?? 0;

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
              Nenhum cliente com sinal no momento.
              {fila?.ambiguos ? (
                <>
                  {" "}
                  <span className="text-[var(--atencao-tinta)]">
                    {fila.ambiguos} cliente(s) ficaram de fora por atribuição ambígua
                  </span>{" "}
                  — têm mais de um contrato com cota, e a reserva não diz de qual balde a hora saiu.
                </>
              ) : null}
            </Vazio>
          ) : (
            <Painel
              rodape={
                fila.truncado ? (
                  <span className="text-[var(--atencao-tinta)]">
                    A análise parou no limite — há mais clientes não avaliados.
                  </span>
                ) : naFila > 12 ? (
                  <>Mostrando os 12 sinais mais fortes de {naFila}.</>
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
                    {fila.itens.slice(0, 12).map((i) => (
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

        <Secao
          titulo="Contexto"
          sub="Números da carteira para embasar a conversa — não são o produto desta tela."
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Cartao
              rotulo="Clientes ativos"
              Icone={Users}
              valor={clientesAtivos.toLocaleString("pt-BR")}
              contexto="elegíveis para oferta"
              procedencia="API"
              confiavel={
                espelho.entidades.find((e) => e.entidade === "customers")?.completa ?? false
              }
              detalheProcedencia="customer.isActive e isBlocked"
            />
            <Cartao
              rotulo={`Receita ${anoCorrente}`}
              Icone={Wallet}
              valor={formatBRL(totalAno)}
              contexto={`${agregado._count} clientes faturados`}
              confiavel={espelho.receitaConfiavel}
              detalheProcedencia="Soma de cobranças por data de emissão"
            />
            <TopClientes confiavel={espelho.receitaConfiavel} total={totalAno} />
          </div>
          <QuedaDeReceita mesFechado={mesFechado} confiavel={espelho.receitaConfiavel} />
        </Secao>
      </div>
    </>
  );
}

async function TopClientes({
  confiavel,
  total,
}: {
  confiavel: boolean;
  total: ReturnType<typeof money>;
}) {
  const perfis = await prisma.customerProfile.findMany({
    where: { receitaAnoCorrente: { gt: 0 } },
    select: {
      customerConexaId: true,
      receitaAnoCorrente: true,
      customer: { select: { name: true } },
    },
    orderBy: { receitaAnoCorrente: "desc" },
    take: 20,
  });

  const top = topClientes(
    perfis.map((p) => ({
      customerConexaId: p.customerConexaId,
      nome: p.customer?.name ?? null,
      receita: money(p.receitaAnoCorrente.toString()),
    })),
    5,
  );

  return (
    <div className="cartao flex flex-col px-4 py-3.5 sm:col-span-2 lg:col-span-1">
      <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-[var(--tinta-2)]">
        <Trophy size={13.5} className="shrink-0 text-[var(--tinta-3)]" />
        Top 5 do ano
      </div>
      {!confiavel ? (
        <p className="mt-2 text-[13px] leading-relaxed text-[var(--tinta-3)]">
          Indisponível: um ranking sobre carga parcial aponta o cliente errado.
        </p>
      ) : top.length === 0 ? (
        <p className="mt-2 text-[13px] text-[var(--tinta-3)]">Nenhum cliente com receita.</p>
      ) : (
        <ol className="mt-2.5 space-y-1.5">
          {top.map((c, i) => {
            const share = participacao(c.receita, total);
            return (
              <li key={c.customerConexaId} className="flex items-center gap-2 text-[12.5px]">
                <span className="num w-3 shrink-0 text-[var(--tinta-3)]">{i + 1}</span>
                <Link
                  href={`/carteira/${c.customerConexaId}`}
                  className="min-w-0 flex-1 truncate hover:text-[var(--acento-tinta)] hover:underline"
                >
                  {c.nome ?? `Cliente ${c.customerConexaId}`}
                </Link>
                {/* A barra dá a proporção de relance; o número dá o valor. */}
                <span aria-hidden className="barra hidden w-10 shrink-0 sm:block">
                  <span style={{ width: `${Math.min(100, share ?? 0)}%` }} />
                </span>
                <span className="num w-8 shrink-0 text-right text-[var(--tinta-3)]">
                  {share?.toFixed(0) ?? "—"}%
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <div className="mt-auto pt-3">
        <Procedencia tipo={confiavel ? "DERIVADO" : "INDISPONIVEL"} />
      </div>
    </div>
  );
}

async function QuedaDeReceita({
  mesFechado,
  confiavel,
}: {
  mesFechado: string;
  confiavel: boolean;
}) {
  if (!confiavel) return null;

  const emQueda = await prisma.customerMonthlyRevenue.findMany({
    where: { mesKey: mesFechado, variacaoPct: { lte: -30 } },
    select: {
      customerConexaId: true,
      receita: true,
      variacaoPct: true,
      customer: { select: { name: true } },
    },
    orderBy: { variacaoPct: "asc" },
    take: 8,
  });

  if (emQueda.length === 0) return null;

  return (
    <Painel
      titulo={
        <span className="flex items-center gap-1.5">
          <TrendingDown size={14} className="text-[var(--critico-tinta)]" />
          Queda de receita em {rotuloMes(mesFechado)}
        </span>
      }
      rodape="Entre quem tem mês anterior para comparar."
    >
      <Rolante>
        <table className="tabela">
          <tbody>
            {emQueda.map((m) => (
              <tr key={m.customerConexaId}>
                <td>
                  <Link
                    href={`/carteira/${m.customerConexaId}`}
                    className="hover:text-[var(--acento-tinta)] hover:underline"
                  >
                    {m.customer?.name ?? `Cliente ${m.customerConexaId}`}
                  </Link>
                </td>
                <td
                  className={`num w-24 text-right font-medium ${corVariacao(Number(m.variacaoPct))}`}
                >
                  {pct(Number(m.variacaoPct))}
                </td>
                <td className="num w-32 text-right">{formatBRL(m.receita.toString())}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Rolante>
    </Painel>
  );
}

