import { prisma } from "@/lib/db";
import { formatBRL, money, roundMoney, sum, variacaoPercentual } from "@/lib/money";
import { currentMonthKey, rotuloMes, ultimosMesesFechados } from "@/lib/dates";
import { Procedencia } from "@/components/Procedencia";
import { estadoDoEspelho } from "@/lib/intel/completude";
import { AvisoCompletude, ValorOuLacuna } from "@/components/AvisoCompletude";
import { corVariacao, pct } from "@/lib/ui";

export async function SerieMensalDaCarteira() {
  const meses = [...ultimosMesesFechados(12), currentMonthKey()];
  const espelho = await estadoDoEspelho();

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
        <h2 className="text-[17px] font-semibold tracking-tight">Receita mês a mês</h2>
        <p className="mt-1 text-sm text-[var(--tinta-3)]">
          Regime de <strong>emissão</strong>, valor com juros e multa. Canceladas e negociadas fora.
          Mesma régua do Dashboard Financeiro.
        </p>
      </div>

      <AvisoCompletude estado={espelho} />

      <div className="cartao px-4 py-3">
        <div className="text-sm text-[var(--tinta-3)]">Total dos 12 meses fechados</div>
        <div className="mt-1 text-2xl font-semibold num">
          {/* Mesmo gate do Panorama. Sem isto, com a carga de cobranças parada,
              o Panorama dizia "indisponível" e esta tela dizia um total com selo
              de fato — duas telas do mesmo dashboard se contradizendo. */}
          <ValorOuLacuna valor={formatBRL(totalFechado)} confiavel={espelho.receitaConfiavel} />
        </div>
        <div className="mt-1">
          <Procedencia tipo={espelho.receitaConfiavel ? "DERIVADO" : "INDISPONIVEL"} />
        </div>
      </div>

      <div className="overflow-x-auto cartao">
        <table className="tabela">
          <thead className="border-b border-[var(--linha)] text-left text-xs uppercase tracking-wide text-[var(--tinta-3)]">
            <tr>
              <th className="px-4 py-2 font-medium">Mês</th>
              <th className="px-4 py-2 font-medium">Volume</th>
              <th className="px-4 py-2 text-right font-medium">Cobranças</th>
              <th className="px-4 py-2 text-right font-medium">Receita</th>
              <th className="px-4 py-2 text-right font-medium">Variação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--linha)]">
            {serie.map((p) => (
              <tr key={p.mesKey} className={p.emCurso ? "bg-[var(--wash-atencao)]" : ""}>
                <td className="px-4 py-2 whitespace-nowrap">
                  {rotuloMes(p.mesKey)}
                  {p.emCurso ? <span className="ml-2 text-xs text-[var(--atencao-tinta)]">em curso</span> : null}
                </td>
                <td className="px-4 py-2">
                  <div className="h-2 w-full max-w-xs rounded bg-[var(--superficie-sutil)]">
                    <div
                      className={p.emCurso ? "h-2 rounded bg-[var(--atencao)]" : "h-2 rounded bg-[var(--serie-1)]"}
                      style={{
                        width: maximo.isZero()
                          ? "0%"
                          : `${Number(p.receita.div(maximo).times(100).toFixed(1))}%`,
                      }}
                    />
                  </div>
                </td>
                <td className="px-4 py-2 text-right num text-[var(--tinta-3)]">{p.cobrancas}</td>
                <td className="px-4 py-2 text-right num">{formatBRL(p.receita)}</td>
                <td className={`px-4 py-2 text-right num ${corVariacao(p.variacao)}`}>
                  {pct(p.variacao)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-[var(--tinta-3)]">
        O mês em curso aparece destacado e <strong>não</strong> entra no total nem alimenta alerta —
        comparar um mês pela metade com um mês inteiro marcaria a base toda em queda.
      </p>
    </div>
  );
}
