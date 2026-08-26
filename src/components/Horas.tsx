import type { ConsumoDoCiclo } from "@/lib/metrics/horas";
import type { HorasDoCliente } from "@/lib/intel/horas";
import { Procedencia } from "@/components/Procedencia";

const h = (v: { toFixed: (n: number) => string } | null) =>
  v === null ? "—" : `${Number(v.toFixed(2))}h`.replace(".", ",");

/** Bloco de horas do cliente: cota, ciclo atual e histórico de ciclos. */
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

  const semCota = dados.concedido === null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-6 text-sm">
        <div>
          <div className="text-xs text-neutral-500">Plano</div>
          <div className="font-medium">{dados.planoNome ?? "—"}</div>
        </div>
        <div>
          <div className="text-xs text-neutral-500">Cota por ciclo</div>
          <div className="font-medium">
            {semCota ? (
              <span title="Plano sem horas inclusas — é o desenho do Endereço Fiscal Litoral">
                sem cota
              </span>
            ) : (
              h(dados.concedido)
            )}
          </div>
        </div>
        {dados.sinal?.usoMedioPct !== null && dados.sinal?.usoMedioPct !== undefined ? (
          <div>
            <div className="text-xs text-neutral-500">Uso médio da cota</div>
            <div
              className={`font-medium ${dados.sinal.usoMedioPct > 100 ? "text-red-700" : ""}`}
            >
              {dados.sinal.usoMedioPct.toFixed(0)}%
            </div>
          </div>
        ) : null}
      </div>

      {dados.sinal?.recorrente ? (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          <strong>Estoura a cota com recorrência.</strong> {dados.sinal.ciclosComEstouro} dos{" "}
          {dados.sinal.ciclos.length} ciclos fechados, somando {h(dados.sinal.horasExcedentes)} pagas
          por fora do plano. Candidato a upgrade.
        </div>
      ) : null}

      <TabelaCiclos ciclos={dados.fechados} atual={dados.cicloAtual} semCota={semCota} />

      <p className="text-xs text-neutral-500">
        <Procedencia tipo="API" detalhe="plan.hourQuotas" /> cota ·{" "}
        <Procedencia tipo="DERIVADO" detalhe="soma das reservas por ciclo" /> consumo. O ciclo é
        ancorado na <strong>data de contratação</strong>, não no mês. Sem carry-over: horas não
        usadas expiram. O excedente é o que o Conexa <strong>faturou</strong>, não uma conta nossa.
      </p>
    </div>
  );
}

function TabelaCiclos({
  ciclos,
  atual,
  semCota,
}: {
  ciclos: ConsumoDoCiclo[];
  atual: ConsumoDoCiclo | null;
  semCota: boolean;
}) {
  const linhas = [...ciclos, ...(atual ? [atual] : [])];
  if (!linhas.length) return <p className="text-sm text-neutral-500">Nenhum ciclo fechado ainda.</p>;

  return (
    <div className="overflow-x-auto rounded border border-neutral-200 bg-white">
      <table className="w-full text-sm">
        <thead className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
          <tr>
            <th className="px-4 py-2 font-medium">Ciclo</th>
            <th className="px-4 py-2 text-right font-medium">Reservas</th>
            <th className="px-4 py-2 text-right font-medium">Abatido da cota</th>
            <th className="px-4 py-2 text-right font-medium">Faturado à parte</th>
            <th className="px-4 py-2 text-right font-medium">{semCota ? "Total" : "Saldo"}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {linhas.map((c, i) => {
            const eAtual = atual !== null && i === linhas.length - 1;
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
