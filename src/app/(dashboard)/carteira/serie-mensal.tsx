import { prisma } from "@/lib/db";
import { formatBRL, money, roundMoney, sum, variacaoPercentual } from "@/lib/money";
import { currentMonthKey, rotuloMes, ultimosMesesFechados } from "@/lib/dates";
import { Procedencia } from "@/components/Procedencia";
import { estadoDoEspelho } from "@/lib/intel/completude";
import { ValorOuLacuna } from "@/components/AvisoCompletude";
import { corVariacao, pct } from "@/lib/ui";
import { Nota, Painel, Rolante } from "@/components/Cartao";

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
  const totalFechado = roundMoney(
    sum(serie.filter((p) => !p.emCurso).map((p) => p.receita.toString())),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <h2 className="text-[17px] font-semibold tracking-tight">Receita mês a mês</h2>
          <p className="mt-1 max-w-2xl text-[14px] text-[var(--tinta-2)]">
            Regime de <strong className="font-semibold text-[var(--tinta)]">emissão</strong>, valor
            com juros e multa. Canceladas e negociadas fora. Mesma régua do Dashboard Financeiro.
          </p>
        </div>
        {/* O total sai do cartão solto e vira o número do cabeçalho: um stat
            tile de largura inteira só para repetir uma soma era desperdício de
            uma faixa da tela. */}
        <div className="text-right">
          <div className="text-[12.5px] text-[var(--tinta-3)]">12 meses fechados</div>
          <div className="num mt-0.5 text-[22px] font-semibold leading-none tracking-[-0.02em]">
            <ValorOuLacuna valor={formatBRL(totalFechado)} confiavel={espelho.receitaConfiavel} />
          </div>
          <div className="mt-1.5">
            <Procedencia tipo={espelho.receitaConfiavel ? "DERIVADO" : "INDISPONIVEL"} />
          </div>
        </div>
      </div>

      {/* ⚠ Sem AvisoCompletude aqui: a Carteira já o mostra no topo, e as duas
          faixas idênticas apareciam na mesma rolagem. Repetir um aviso o
          transforma em ruído — a segunda cópia ensina a ignorar a primeira. */}

      <Painel>
        <Rolante>
          <table className="tabela">
            <thead>
              <tr>
                <th>Mês</th>
                <th className="w-[38%]">Volume</th>
                <th className="text-right">Cobranças</th>
                <th className="text-right">Receita</th>
                <th className="text-right">Variação</th>
              </tr>
            </thead>
            <tbody>
              {serie.map((p) => (
                <tr key={p.mesKey} className={p.emCurso ? "linha-curso" : undefined}>
                  <td className="whitespace-nowrap">
                    {rotuloMes(p.mesKey)}
                    {p.emCurso ? <span className="selo selo-atencao ml-2">em curso</span> : null}
                  </td>
                  <td>
                    <span className="barra block max-w-[260px]">
                      <span
                        className={p.emCurso ? "!bg-[var(--atencao)]" : undefined}
                        style={{
                          width: maximo.isZero()
                            ? "0%"
                            : `${Number(p.receita.div(maximo).times(100).toFixed(1))}%`,
                        }}
                      />
                    </span>
                  </td>
                  {/* ⚠ As três colunas passam pelo MESMO portão do total do
                      cabeçalho. Antes só o total era protegido: a tabela abaixo
                      dele imprimia "R$ 0,00" mês a mês, com cara de fato, sobre
                      exatamente a receita que o cabeçalho acabava de declarar
                      indisponível. Um portão que protege o resumo e libera o
                      detalhe não é portão — é decoração. */}
                  <td className="num text-right text-[var(--tinta-3)]">
                    {espelho.receitaConfiavel ? p.cobrancas : "—"}
                  </td>
                  <td className="num text-right font-medium">
                    <ValorOuLacuna
                      valor={formatBRL(p.receita)}
                      confiavel={espelho.receitaConfiavel}
                    />
                  </td>
                  <td
                    className={`num text-right ${espelho.receitaConfiavel ? corVariacao(p.variacao) : ""}`}
                  >
                    {espelho.receitaConfiavel ? pct(p.variacao) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Rolante>
      </Painel>

      <Nota>
        O mês em curso aparece destacado e <strong>não</strong> entra no total nem alimenta alerta —
        comparar um mês pela metade com um mês inteiro marcaria a base toda em queda.
      </Nota>
    </div>
  );
}
