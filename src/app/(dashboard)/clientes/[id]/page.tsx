import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatBRL } from "@/lib/money";
import { currentMonthKey, rotuloMes, ultimosMesesFechados } from "@/lib/dates";
import { Lacuna, Procedencia } from "@/components/Procedencia";
import { corVariacao, pct } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function ClienteDetalhe({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const conexaId = Number(id);
  if (!Number.isInteger(conexaId)) notFound();

  const [cliente, perfil, mensais, contratos] = await Promise.all([
    prisma.customer.findUnique({ where: { conexaId } }),
    prisma.customerProfile.findUnique({ where: { customerConexaId: conexaId } }),
    prisma.customerMonthlyRevenue.findMany({
      where: { customerConexaId: conexaId },
      orderBy: { mesKey: "asc" },
    }),
    prisma.contract.findMany({
      where: { customerConexaId: conexaId },
      orderBy: [{ isActive: "desc" }, { startDate: "desc" }],
    }),
  ]);

  if (!cliente) notFound();

  const mesCorrente = currentMonthKey();
  const doze = ultimosMesesFechados(12);
  const serie = mensais.filter((m) => doze.includes(m.mesKey) || m.mesKey === mesCorrente);
  const planoIds = [...new Set(contratos.map((c) => c.planConexaId).filter((x): x is number => x !== null))];
  const planos = planoIds.length
    ? await prisma.plan.findMany({ where: { conexaId: { in: planoIds } } })
    : [];
  const planoPorId = new Map(planos.map((p) => [p.conexaId, p]));

  const inelegivel = !cliente.isActive || cliente.isBlocked;

  return (
    <div className="space-y-8">
      <div>
        <Link href="/clientes" className="text-sm text-neutral-500 hover:underline">
          ← Clientes
        </Link>
        <h1 className="mt-1 text-xl font-semibold">
          {cliente.name ?? `Cliente ${conexaId}`}{" "}
          <span className="text-base font-normal text-neutral-400">#{conexaId}</span>
        </h1>
        {inelegivel ? (
          <p className="mt-2 rounded bg-neutral-100 px-3 py-2 text-sm text-neutral-700">
            Cliente {cliente.isBlocked ? "bloqueado" : "inativo"} no Conexa — <strong>não é elegível</strong>{" "}
            para oferta. Ver ADR-0010.
          </p>
        ) : null}
      </div>

      <section className="grid gap-4 sm:grid-cols-3">
        <Cartao titulo="Receita no ano" valor={formatBRL(perfil?.receitaAnoCorrente?.toString() ?? 0)} />
        <Cartao titulo="Receita 12 meses" valor={formatBRL(perfil?.receita12Meses?.toString() ?? 0)} />
        <div className="rounded border border-neutral-200 bg-white px-4 py-3">
          <div className="text-sm text-neutral-500">Horas inclusas por mês</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">
            {perfil?.horasInclusasMes != null ? (
              `${Number(perfil.horasInclusasMes)}h`
            ) : perfil?.temContratoAtivo ? (
              <span className="text-lg font-normal">sem cota</span>
            ) : (
              <span className="text-lg font-normal">
                <Lacuna motivo="Cliente sem contrato ativo — não há plano de onde ler a cota" />
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-neutral-500">
            <Procedencia tipo="API" detalhe="plan.hourQuotas" />
            {perfil?.horasInclusasMes == null && perfil?.temContratoAtivo
              ? "plano sem horas inclusas (não é zero)"
              : "concessão do plano"}
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Receita mês a mês</h2>
        {serie.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-500">Sem receita registrada no período.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Mês</th>
                  <th className="px-4 py-2 text-right font-medium">Cobranças</th>
                  <th className="px-4 py-2 text-right font-medium">Receita</th>
                  <th className="px-4 py-2 text-right font-medium">Variação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {serie.map((m) => (
                  <tr key={m.mesKey} className={m.mesKey === mesCorrente ? "bg-amber-50/50" : ""}>
                    <td className="px-4 py-2">
                      {rotuloMes(m.mesKey)}
                      {m.mesKey === mesCorrente ? (
                        <span className="ml-2 text-xs text-amber-700">mês em curso — incompleto</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-neutral-500">{m.cobrancas}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatBRL(m.receita.toString())}</td>
                    <td
                      className={`px-4 py-2 text-right tabular-nums ${corVariacao(
                        m.variacaoPct === null ? null : Number(m.variacaoPct),
                      )}`}
                      title={m.variacaoPct === null ? "Mês anterior sem receita — não existe variação percentual" : undefined}
                    >
                      {pct(m.variacaoPct === null ? null : Number(m.variacaoPct))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-neutral-500">
          O traço na variação significa <strong>mês anterior sem receita</strong> — não é queda de 100%.
          O mês em curso aparece para consulta e <strong>nunca</strong> alimenta alerta de tendência.
        </p>
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Contratos</h2>
        {contratos.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-500">Nenhum contrato.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Plano</th>
                  <th className="px-4 py-2 font-medium">Início</th>
                  <th className="px-4 py-2 font-medium">Fim</th>
                  <th className="px-4 py-2 text-right font-medium">Horas/mês</th>
                  <th className="px-4 py-2 text-right font-medium">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {contratos.map((c) => {
                  const plano = c.planConexaId !== null ? planoPorId.get(c.planConexaId) : undefined;
                  return (
                    <tr key={c.conexaId} className={c.isActive ? "" : "text-neutral-400"}>
                      <td className="px-4 py-2">
                        {plano?.name ?? c.contractSummary ?? `Plano ${c.planConexaId ?? "?"}`}
                        {!c.isActive ? <span className="ml-2 text-xs">encerrado</span> : null}
                      </td>
                      <td className="px-4 py-2 tabular-nums">{fmtData(c.startDate)}</td>
                      <td className="px-4 py-2 tabular-nums">{fmtData(c.endDate)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {plano?.horasInclusasMes != null ? `${Number(plano.horasInclusasMes)}h` : "sem cota"}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatBRL(c.amount.toString())}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function fmtData(d: Date | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(d);
}

function Cartao({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div className="rounded border border-neutral-200 bg-white px-4 py-3">
      <div className="text-sm text-neutral-500">{titulo}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{valor}</div>
      <div className="mt-1">
        <Procedencia tipo="DERIVADO" detalhe="Soma de cobranças por data de emissão" />
      </div>
    </div>
  );
}
