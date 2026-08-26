import type { ConsumoDoCiclo } from "@/lib/metrics/horas";
import type { HorasDoCliente, HorasDoContrato } from "@/lib/intel/horas";
import { Procedencia } from "@/components/Procedencia";

const h = (v: { toFixed: (n: number) => string } | null) =>
  v === null ? "—" : `${Number(v.toFixed(2))}h`.replace(".", ",");

/**
 * Horas do cliente, **um bloco por contrato**.
 *
 * Cada contrato tem o seu ciclo, ancorado na data de contratação dele. Juntar
 * tudo num bloco só misturaria janelas que não coincidem.
 */
export function BlocoHoras({ dados, confiavel }: { dados: HorasDoCliente; confiavel: boolean }) {
  if (dados.semContrato) {
    return (
      <p className="text-sm text-neutral-500">
        Cliente sem contrato ativo com plano — não há cota de horas a medir.
      </p>
    );
  }

  if (!confiavel) {
    return (
      <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        A carga de reservas não terminou. Mostrar consumo agora daria número parcial com cara de
        fato — e sobre ele o cliente pareceria estar usando menos horas do que usa.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {dados.atribuicaoAmbigua ? (
        <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <strong>Atribuição ambígua.</strong> Este cliente tem mais de um contrato com cota, e a
          reserva não diz de qual balde a hora saiu. O consumo aparece repetido em cada bloco
          abaixo, porque é o consumo do cliente inteiro — <strong>não</strong> é conclusivo por
          contrato, e este cliente fica de fora da fila automática.
        </div>
      ) : null}

      {dados.sinal?.recorrente ? (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          <strong>Estoura a cota com recorrência.</strong> {dados.sinal.ciclosComEstouro} dos{" "}
          {dados.sinal.ciclosConclusivos} ciclos conclusivos, somando{" "}
          {h(dados.sinal.horasExcedentes)} pagas por fora do plano. Candidato a upgrade.
        </div>
      ) : null}

      {dados.contratos.map((c) => (
        <BlocoContrato key={c.contratoConexaId} contrato={c} />
      ))}

      <p className="text-xs text-neutral-500">
        <Procedencia tipo="API" detalhe="plan.hourQuotas" /> cota ·{" "}
        <Procedencia tipo="DERIVADO" detalhe="soma das reservas por ciclo" /> consumo. O ciclo é
        ancorado na <strong>data de contratação de cada contrato</strong>, não no mês. Sem
        carry-over: horas não usadas expiram. O excedente é o que o Conexa{" "}
        <strong>faturou</strong>, não uma conta nossa.
      </p>
    </div>
  );
}

function BlocoContrato({ contrato }: { contrato: HorasDoContrato }) {
  const semCota = contrato.concedido === null;
  const linhas = [...contrato.fechados, ...(contrato.cicloAtual ? [contrato.cicloAtual] : [])];

  return (
    <div className="rounded border border-neutral-200 bg-white">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-b border-neutral-100 px-4 py-3">
        <div>
          <div className="text-xs text-neutral-500">Plano</div>
          <div className="text-sm font-medium">{contrato.planoNome ?? "—"}</div>
        </div>
        <div>
          <div className="text-xs text-neutral-500">Cota por ciclo</div>
          <div className="text-sm font-medium">
            {semCota ? (
              <span title="Plano sem horas inclusas — é o desenho do Endereço Fiscal Litoral">
                sem cota
              </span>
            ) : (
              h(contrato.concedido)
            )}
          </div>
        </div>
        <div>
          <div className="text-xs text-neutral-500">Contrato desde</div>
          <div className="text-sm font-medium tabular-nums">
            {new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(contrato.inicio)}
          </div>
        </div>
        {contrato.sinal?.usoMedioPct != null ? (
          <div>
            <div className="text-xs text-neutral-500">Uso médio da cota</div>
            <div
              className={`text-sm font-medium ${contrato.sinal.usoMedioPct > 100 ? "text-red-700" : ""}`}
            >
              {contrato.sinal.usoMedioPct.toFixed(0)}%
            </div>
          </div>
        ) : null}
        <div className="ml-auto text-xs text-neutral-400">#{contrato.contratoConexaId}</div>
      </div>

      {contrato.fechados.some((c) => !c.conclusivo) ? (
        <p className="border-b border-neutral-100 bg-amber-50 px-4 py-2 text-xs text-amber-900">
          <strong>Ciclos não conclusivos.</strong> Alguma reserva não pôde ser classificada —
          duração ausente ou status fora dos documentados. Esses ciclos não contam para o sinal: um
          ciclo com buraco não confirma nem nega estouro.
        </p>
      ) : null}

      {linhas.length === 0 ? (
        <p className="px-4 py-3 text-sm text-neutral-500">Nenhum ciclo fechado ainda.</p>
      ) : (
        <TabelaCiclos linhas={linhas} temAtual={contrato.cicloAtual !== null} semCota={semCota} />
      )}
    </div>
  );
}

function TabelaCiclos({
  linhas,
  temAtual,
  semCota,
}: {
  linhas: ConsumoDoCiclo[];
  temAtual: boolean;
  semCota: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-neutral-100 text-left text-xs uppercase tracking-wide text-neutral-500">
          <tr>
            <th className="px-4 py-2 font-medium">Ciclo</th>
            <th className="px-4 py-2 text-right font-medium">Reservas</th>
            <th className="px-4 py-2 text-right font-medium">Abatido da cota</th>
            <th className="px-4 py-2 text-right font-medium">Faturado à parte</th>
            <th className="px-4 py-2 text-right font-medium">Não classificado</th>
            <th className="px-4 py-2 text-right font-medium">{semCota ? "Total" : "Saldo"}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {linhas.map((c, i) => {
            const eAtual = temAtual && i === linhas.length - 1;
            return (
              <tr key={c.ciclo.rotulo + i} className={eAtual ? "bg-amber-50/50" : ""}>
                <td className="px-4 py-2 whitespace-nowrap">
                  {c.ciclo.rotulo}
                  {eAtual ? <span className="ml-2 text-xs text-amber-700">em curso</span> : null}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-neutral-500">{c.reservas}</td>
                <td className="px-4 py-2 text-right tabular-nums">{h(c.abatido)}</td>
                <td
                  className={`px-4 py-2 text-right tabular-nums ${c.estourou ? "font-medium text-red-700" : ""}`}
                >
                  {h(c.faturado)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-neutral-500">
                  {/* naoFaturado (ambíguo) + horasDesconhecidas (buraco). Eram
                      calculados e nunca exibidos — cálculo invisível é o mesmo
                      que não ter. */}
                  {c.naoFaturado.isZero() && c.horasDesconhecidas.isZero() ? (
                    "—"
                  ) : (
                    <span title="Reservas não faturadas (cobrança pendente ou cortesia) e reservas que não pudemos classificar">
                      {h(c.naoFaturado.plus(c.horasDesconhecidas))}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {semCota ? h(c.consumido) : h(c.saldo)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
