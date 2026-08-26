import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatBRL } from "@/lib/money";
import { rotuloMes, ultimoMesFechado } from "@/lib/dates";
import { Procedencia } from "@/components/Procedencia";
import { SerieMensalDaCarteira } from "./serie-mensal";
import { corVariacao, pct } from "@/lib/ui";
import { estadoDoEspelho } from "@/lib/intel/completude";
import { AvisoCompletude, ValorOuLacuna } from "@/components/AvisoCompletude";

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
    where: busca
      ? { customer: { name: { contains: busca, mode: "insensitive" } } }
      : undefined,
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
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-[26px] font-semibold tracking-tight">Carteira</h1>
        <span className="text-sm text-[var(--tinta-3)]">{perfis.length} exibidos</span>
      </div>

      <AvisoCompletude estado={espelho} />

      <form className="flex gap-2">
        <input
          name="q"
          defaultValue={busca}
          placeholder="Buscar por nome"
          className="w-full max-w-sm rounded border border-[var(--linha)] px-3 py-2 text-sm"
        />
        <button className="rounded border border-[var(--linha)] px-3 py-2 text-sm">Buscar</button>
      </form>

      {perfis.length === 0 ? (
        <p className="text-sm text-[var(--tinta-3)]">
          {busca ? "Nenhum cliente com esse nome." : "Nenhum cliente no espelho ainda — rode a primeira carga em Motor."}
        </p>
      ) : (
        <div className="overflow-x-auto cartao">
          <table className="tabela">
            <thead className="border-b border-[var(--linha)] text-left text-xs uppercase tracking-wide text-[var(--tinta-3)]">
              <tr>
                <th className="px-4 py-2 font-medium">Cliente</th>
                <th className="px-4 py-2 font-medium">Segmento</th>
                <th className="px-4 py-2 text-right font-medium">Horas/mês</th>
                <th className="px-4 py-2 text-right font-medium">Receita no ano</th>
                <th className="px-4 py-2 text-right font-medium">{rotuloMes(mesFechado)}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--linha)]">
              {perfis.map((p) => {
                const v = varPorCliente.get(p.customerConexaId);
                const inelegivel = !p.customer?.isActive || p.customer?.isBlocked;
                return (
                  <tr key={p.customerConexaId} className={inelegivel ? "bg-[var(--superficie-sutil)] text-[var(--tinta-3)]" : ""}>
                    <td className="px-4 py-2">
                      <Link href={`/carteira/${p.customerConexaId}`} className="hover:underline">
                        {p.customer?.name ?? `Cliente ${p.customerConexaId}`}
                      </Link>
                      {inelegivel ? (
                        <span className="ml-2 rounded bg-[var(--superficie-sutil)] px-1.5 py-0.5 text-[10px] uppercase text-[var(--tinta-2)]">
                          {p.customer?.isBlocked ? "bloqueado" : "inativo"}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2 text-[var(--tinta-2)]">
                      {p.segmentos.length ? p.segmentos.join(", ") : "—"}
                    </td>
                    <td className="px-4 py-2 text-right num">
                      {p.horasInclusasMes === null
                        ? p.temContratoAtivo
                          ? <span title="Plano sem horas inclusas — é o caso do Endereço Fiscal Litoral">sem cota</span>
                          : "—"
                        : `${Number(p.horasInclusasMes)}h`}
                    </td>
                    <td className="px-4 py-2 text-right num">
                      <ValorOuLacuna
                        valor={formatBRL(p.receitaAnoCorrente.toString())}
                        confiavel={espelho.receitaConfiavel}
                      />
                    </td>
                    <td className={`px-4 py-2 text-right num ${corVariacao(v === null || v === undefined ? null : Number(v))}`}>
                      {pct(v === null || v === undefined ? null : Number(v))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="border-t border-[var(--linha)] pt-8">
        <SerieMensalDaCarteira />
      </div>

      <p className="text-xs text-[var(--tinta-3)]">
        <Procedencia tipo="DERIVADO" /> receita no regime de emissão ·{" "}
        <Procedencia tipo="API" /> horas inclusas vêm de <code>plan.hourQuotas</code>. &quot;Sem cota&quot;
        significa plano sem horas inclusas, e não zero hora.
      </p>
    </div>
  );
}
