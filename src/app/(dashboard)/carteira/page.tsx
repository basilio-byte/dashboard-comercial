import Link from "next/link";
import { Search, UserX } from "lucide-react";
import { prisma } from "@/lib/db";
import { formatBRL } from "@/lib/money";
import { rotuloMes, ultimoMesFechado } from "@/lib/dates";
import { Procedencia } from "@/components/Procedencia";
import { SerieMensalDaCarteira } from "./serie-mensal";
import { MetricasDaCarteira } from "./metricas";
import { corVariacao, pct } from "@/lib/ui";
import { estadoDoEspelho } from "@/lib/intel/completude";
import { AvisoCompletude, ValorOuLacuna } from "@/components/AvisoCompletude";
import { Cabecalho, Nota, Painel, Rolante, Vazio } from "@/components/Cartao";

export const dynamic = "force-dynamic";

export default async function Carteira({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const busca = (q ?? "").trim();
  const mesFechado = ultimoMesFechado();
  const espelho = await estadoDoEspelho();

  const perfis = await prisma.customerProfile.findMany({
    where: busca ? { customer: { name: { contains: busca, mode: "insensitive" } } } : undefined,
    orderBy: { receitaAnoCorrente: "desc" },
    take: 200,
    select: {
      customerConexaId: true,
      receitaAnoCorrente: true,
      segmentos: true,
      horasInclusasMes: true,
      temContratoAtivo: true,
      customer: { select: { name: true, isActive: true, isBlocked: true } },
    },
  });

  const variacoes = await prisma.customerMonthlyRevenue.findMany({
    where: { mesKey: mesFechado, customerConexaId: { in: perfis.map((p) => p.customerConexaId) } },
    select: { customerConexaId: true, variacaoPct: true },
  });
  const varPorCliente = new Map(variacoes.map((v) => [v.customerConexaId, v.variacaoPct]));

  return (
    <>
      <Cabecalho
        titulo="Carteira"
        sub="Seus clientes, e o que já se sabe sobre cada um. A receita vive aqui dentro, como atributo — não como tela própria."
        acao={
          <form className="flex gap-2">
            <div className="relative">
              <Search
                size={14}
                aria-hidden
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--tinta-3)]"
              />
              <input
                name="q"
                defaultValue={busca}
                placeholder="Buscar por nome"
                className="campo w-full pl-8 sm:w-64"
              />
            </div>
            <button className="btn">Buscar</button>
          </form>
        }
      />

      <div className="space-y-6">
        <AvisoCompletude estado={espelho} />

        {perfis.length === 0 ? (
          <Vazio Icone={UserX}>
            {busca ? (
              <>
                Nenhum cliente com <strong>{busca}</strong> no nome.
              </>
            ) : (
              "Nenhum cliente no espelho ainda — rode a primeira carga em Motor."
            )}
          </Vazio>
        ) : (
          <Painel
            titulo={
              <>
                {perfis.length} {perfis.length === 1 ? "cliente" : "clientes"}
                {busca ? <> para &quot;{busca}&quot;</> : null}
                {perfis.length === 200 ? (
                  <span className="text-[var(--tinta-3)]"> · limite da página</span>
                ) : null}
              </>
            }
          >
            <Rolante>
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Segmento</th>
                    <th className="text-right">Horas/mês</th>
                    <th className="text-right">Receita no ano</th>
                    <th className="text-right">{rotuloMes(mesFechado)}</th>
                  </tr>
                </thead>
                <tbody>
                  {perfis.map((p) => {
                    const v = varPorCliente.get(p.customerConexaId);
                    const inelegivel = !p.customer?.isActive || p.customer?.isBlocked;
                    return (
                      <tr key={p.customerConexaId} className={inelegivel ? "opacity-55" : undefined}>
                        <td>
                          <Link
                            href={`/carteira/${p.customerConexaId}`}
                            className="font-medium hover:text-[var(--acento-tinta)] hover:underline"
                          >
                            {p.customer?.name ?? `Cliente ${p.customerConexaId}`}
                          </Link>
                          {inelegivel ? (
                            <span className="selo ml-2">
                              {p.customer?.isBlocked ? "bloqueado" : "inativo"}
                            </span>
                          ) : null}
                        </td>
                        <td className="text-[var(--tinta-2)]">
                          {p.segmentos.length ? p.segmentos.join(", ") : "—"}
                        </td>
                        <td className="num text-right">
                          {p.horasInclusasMes === null ? (
                            p.temContratoAtivo ? (
                              <span
                                className="text-[var(--tinta-3)]"
                                title="Plano sem horas inclusas — é o caso do Endereço Fiscal Litoral"
                              >
                                sem cota
                              </span>
                            ) : (
                              "—"
                            )
                          ) : (
                            `${Number(p.horasInclusasMes)}h`
                          )}
                        </td>
                        <td className="num text-right font-medium">
                          <ValorOuLacuna
                            valor={formatBRL(p.receitaAnoCorrente.toString())}
                            confiavel={espelho.receitaConfiavel}
                          />
                        </td>
                        <td
                          className={`num text-right ${corVariacao(
                            v === null || v === undefined ? null : Number(v),
                          )}`}
                        >
                          {pct(v === null || v === undefined ? null : Number(v))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Rolante>
          </Painel>
        )}

        <Nota>
          <Procedencia tipo="DERIVADO" /> receita no regime de emissão ·{" "}
          <Procedencia tipo="API" /> horas inclusas vêm de{" "}
          <code className="rounded-sm bg-[var(--superficie-sutil)] px-1 py-px">plan.hourQuotas</code>
          . &quot;Sem cota&quot; significa plano sem horas inclusas, e não zero hora.
        </Nota>

        <hr className="divisor !mt-10" />

        {/* Métricas exigidas pela especificação do Diego, movidas do Radar:
            receita é atributo do cliente, não resposta a "quem procurar hoje". */}
        <MetricasDaCarteira confiavel={espelho.receitaConfiavel} />

        <hr className="divisor !mt-10" />

        <SerieMensalDaCarteira />
      </div>
    </>
  );
}
