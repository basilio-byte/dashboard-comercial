import Link from "next/link";
import { TrendingDown } from "lucide-react";
import { prisma } from "@/lib/db";
import { formatBRL, money } from "@/lib/money";
import { rotuloMes, ultimoMesFechado } from "@/lib/dates";
import { participacao, topClientes } from "@/lib/metrics/receita";
import { Painel, Rolante, Secao } from "@/components/Cartao";
import { Procedencia } from "@/components/Procedencia";
import { corVariacao, pct } from "@/lib/ui";

/**
 * TOP 5 e QUEDA DE RECEITA.
 *
 * ⚠ São métricas EXIGIDAS pela especificação do Diego — "top 5 melhores
 * clientes" e "receita nos últimos meses com alerta de queda acima de X%". Não
 * foram removidas: foram **movidas** do Radar para cá.
 *
 * O motivo é de arquitetura de informação, não de importância. O Radar responde
 * "quem procurar hoje, e por quê"; receita não responde isso, e ocupando dois
 * terços daquela tela competia com a fila. Aqui, dentro da Carteira, receita é
 * o que sempre foi: um atributo do cliente. Ver a memória de identidade própria.
 */
export async function MetricasDaCarteira({ confiavel }: { confiavel: boolean }) {
  const mesFechado = ultimoMesFechado();

  const [agregado, perfis, emQueda] = await Promise.all([
    prisma.customerProfile.aggregate({
      where: { receitaAnoCorrente: { gt: 0 } },
      _sum: { receitaAnoCorrente: true },
      _count: true,
    }),
    prisma.customerProfile.findMany({
      where: { receitaAnoCorrente: { gt: 0 } },
      select: {
        customerConexaId: true,
        receitaAnoCorrente: true,
        customer: { select: { name: true } },
      },
      orderBy: { receitaAnoCorrente: "desc" },
      take: 20,
    }),
    prisma.customerMonthlyRevenue.findMany({
      where: { mesKey: mesFechado, variacaoPct: { lte: -30 } },
      select: {
        customerConexaId: true,
        receita: true,
        variacaoPct: true,
        customer: { select: { name: true } },
      },
      orderBy: { variacaoPct: "asc" },
      take: 10,
    }),
  ]);

  const total = money(agregado._sum.receitaAnoCorrente?.toString() ?? 0);
  const top = topClientes(
    perfis.map((p) => ({
      customerConexaId: p.customerConexaId,
      nome: p.customer?.name ?? null,
      receita: money(p.receitaAnoCorrente.toString()),
    })),
    5,
  );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Secao titulo="Top 5 do ano" sub={`${agregado._count} clientes faturados.`}>
        <Painel
          rodape={
            <>
              <Procedencia tipo={confiavel ? "DERIVADO" : "INDISPONIVEL"} /> participação sobre{" "}
              {confiavel ? formatBRL(total) : "a receita do ano"}.
            </>
          }
        >
          {!confiavel ? (
            <p className="px-4 py-5 text-[14px] text-[var(--tinta-3)]">
              Indisponível: um ranking sobre carga parcial aponta o cliente errado.
            </p>
          ) : top.length === 0 ? (
            <p className="px-4 py-5 text-[14px] text-[var(--tinta-3)]">Nenhum cliente com receita.</p>
          ) : (
            <ol className="divide-y divide-[var(--linha)]">
              {top.map((c, i) => {
                const share = participacao(c.receita, total);
                return (
                  <li
                    key={c.customerConexaId}
                    className="flex items-center gap-3 px-4 py-2.5 text-[14px]"
                  >
                    <span className="num w-3 shrink-0 text-[var(--tinta-3)]">{i + 1}</span>
                    <Link
                      href={`/carteira/${c.customerConexaId}`}
                      className="min-w-0 flex-1 truncate hover:text-[var(--acento-tinta)] hover:underline"
                    >
                      {c.nome ?? `Cliente ${c.customerConexaId}`}
                    </Link>
                    <span aria-hidden className="barra hidden w-16 shrink-0 sm:block">
                      <span style={{ width: `${Math.min(100, share ?? 0)}%` }} />
                    </span>
                    <span className="num w-14 shrink-0 text-right font-medium">
                      {formatBRL(c.receita)}
                    </span>
                    <span className="num w-8 shrink-0 text-right text-[var(--tinta-3)]">
                      {share?.toFixed(0) ?? "—"}%
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </Painel>
      </Secao>

      <Secao
        titulo={`Queda em ${rotuloMes(mesFechado)}`}
        sub="Acima de 30%, entre quem tem mês anterior para comparar."
        acao={
          emQueda.length > 0 && confiavel ? (
            <span className="selo selo-critico">
              <TrendingDown size={11.5} aria-hidden />
              {emQueda.length}
            </span>
          ) : null
        }
      >
        <Painel>
          {!confiavel ? (
            <p className="px-4 py-5 text-[14px] text-[var(--tinta-3)]">
              Indisponível enquanto a carga de cobranças não fechar.
            </p>
          ) : emQueda.length === 0 ? (
            <p className="px-4 py-5 text-[14px] text-[var(--tinta-3)]">
              Ninguém caiu mais de 30% no mês fechado.
            </p>
          ) : (
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
                        className={`num w-24 text-right font-medium ${corVariacao(
                          Number(m.variacaoPct),
                        )}`}
                      >
                        {pct(Number(m.variacaoPct))}
                      </td>
                      <td className="num w-28 text-right">{formatBRL(m.receita.toString())}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Rolante>
          )}
        </Painel>
      </Secao>
    </div>
  );
}

