import { prisma } from "@/lib/db";
import { formatBRL, money, roundMoney, sum, variacaoPercentual } from "@/lib/money";
import { currentMonthKey, rotuloMes, ultimosMesesFechados } from "@/lib/dates";
import { Procedencia } from "@/components/Procedencia";
import { corVariacao, pct } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function Receita() {
  const meses = [...ultimosMesesFechados(12), currentMonthKey()];

  const linhas = await prisma.customerMonthlyRevenue.groupBy({
    by: ["mesKey"],
    where: { mesKey: { in: meses } },
    _sum: { receita: true, cobrancas: true },
  });
  const porMes = new Map(linhas.map((l) => [l.mesKey, l._sum]));

  const serie = meses.map((mesKey, i) => {
    const atual = money(porMes.get(mesKey)?.receita?.toString() ?? 0);
    const ant = i === 0 ? null : money(porMes.get(meses[i - 1]!)?.receita?.toString() ?? 0);
    return {
      mesKey,
      receita: atual,
      cobrancas: porMes.get(mesKey)?.cobrancas ?? 0,
      variacao: ant === null ? null : variacaoPercentual(atual, ant),
      emCurso: mesKey === currentMonthKey(),
    };
  });

  const maximo = serie.reduce((m, p) => (p.receita.greaterThan(m) ? p.receita : m), money(0));
  const totalFechado = roundMoney(sum(serie.filter((p) => !p.emCurso).map((p) => p.receita.toString())));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Receita</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Regime de <strong>emissão</strong>, valor com juros e multa. Canceladas e negociadas fora.
          Mesma régua do Dashboard Financeiro.
        </p>
      </div>

      <div className="rounded border border-neutral-200 bg-white px-4 py-3">
        <div className="text-sm text-neutral-500">Total dos 12 meses fechados</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{formatBRL(totalFechado)}</div>
        <div className="mt-1"><Procedencia tipo="DERIVADO" /></div>
      </div>

      <div className="overflow-x-auto rounded border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-4 py-2 font-medium">Mês</th>
              <th className="px-4 py-2 font-medium">Volume</th>
              <th className="px-4 py-2 text-right font-medium">Cobranças</th>
              <th className="px-4 py-2 text-right font-medium">Receita</th>
              <th className="px-4 py-2 text-right font-medium">Variação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {serie.map((p) => (
              <tr key={p.mesKey} className={p.emCurso ? "bg-amber-50/50" : ""}>
                <td className="px-4 py-2 whitespace-nowrap">
                  {rotuloMes(p.mesKey)}
                  {p.emCurso ? <span className="ml-2 text-xs text-amber-700">em curso</span> : null}
                </td>
                <td className="px-4 py-2">
                  <div className="h-2 w-full max-w-xs rounded bg-neutral-100">
                    <div
                      className={p.emCurso ? "h-2 rounded bg-amber-300" : "h-2 rounded bg-neutral-800"}
                      style={{
                        width: maximo.isZero()
                          ? "0%"
                          : `${Number(p.receita.div(maximo).times(100).toFixed(1))}%`,
                      }}
                    />
                  </div>
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-neutral-500">{p.cobrancas}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatBRL(p.receita)}</td>
                <td className={`px-4 py-2 text-right tabular-nums ${corVariacao(p.variacao)}`}>
                  {pct(p.variacao)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-neutral-500">
        O mês em curso aparece destacado e <strong>não</strong> entra no total nem alimenta alerta —
        comparar um mês pela metade com um mês inteiro marcaria a base toda em queda.
      </p>
    </div>
  );
}
