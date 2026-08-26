import type { ConsumoDoCiclo } from "@/lib/metrics/horas";
import type { HorasDoCliente, HorasDoContrato } from "@/lib/intel/horas";
import { Procedencia } from "@/components/Procedencia";
import { Faixa, Nota, Rolante } from "@/components/Cartao";
import { cn } from "@/lib/ui";

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
      <Nota>Cliente sem contrato ativo com plano — não há cota de horas a medir.</Nota>
    );
  }

  if (!confiavel) {
    return (
      <Faixa tom="atencao">
        A carga de reservas não terminou. Mostrar consumo agora daria número parcial com cara de
        fato — e sobre ele o cliente pareceria estar usando menos horas do que usa.
      </Faixa>
    );
  }

  return (
    <div className="space-y-4">
      {dados.atribuicaoAmbigua ? (
        <Faixa tom="atencao">
          <strong>Atribuição ambígua.</strong> Este cliente tem mais de um contrato com cota, e a
          reserva não diz de qual balde a hora saiu. O consumo aparece repetido em cada bloco
          abaixo, porque é o consumo do cliente inteiro — <strong>não</strong> é conclusivo por
          contrato, e este cliente fica de fora da fila automática.
        </Faixa>
      ) : null}

      {dados.sinal?.recorrente ? (
        <Faixa tom="critico">
          <strong>Estoura a cota com recorrência.</strong> {dados.sinal.ciclosComEstouro} dos{" "}
          {dados.sinal.ciclosConclusivos} ciclos conclusivos, somando{" "}
          {h(dados.sinal.horasExcedentes)} pagas por fora do plano. Candidato a upgrade.
        </Faixa>
      ) : null}

      {dados.contratos.map((c) => (
        <BlocoContrato key={c.contratoConexaId} contrato={c} />
      ))}

      <Nota>
        <Procedencia tipo="API" detalhe="plan.hourQuotas" /> cota ·{" "}
        <Procedencia tipo="DERIVADO" detalhe="soma das reservas por ciclo" /> consumo. O ciclo é
        ancorado na <strong>data de contratação de cada contrato</strong>, não no mês. Sem
        carry-over: horas não usadas expiram. O excedente é o que o Conexa{" "}
        <strong>faturou</strong>, não uma conta nossa.
      </Nota>
    </div>
  );
}

function BlocoContrato({ contrato }: { contrato: HorasDoContrato }) {
  const semCota = contrato.concedido === null;
  const linhas = [...contrato.fechados, ...(contrato.cicloAtual ? [contrato.cicloAtual] : [])];
  const estourando = contrato.sinal?.usoMedioPct != null && contrato.sinal.usoMedioPct > 100;

  return (
    <div className="cartao overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-7 gap-y-3 border-b border-[var(--linha)] px-4 py-3">
        <Campo rotulo="Plano" valor={contrato.planoNome ?? "—"} />
        <Campo
          rotulo="Cota por ciclo"
          valor={
            semCota ? (
              <span
                className="text-[var(--tinta-3)]"
                title="Plano sem horas inclusas — é o desenho do Endereço Fiscal Litoral"
              >
                sem cota
              </span>
            ) : (
              h(contrato.concedido)
            )
          }
        />
        <Campo
          rotulo="Contrato desde"
          valor={
            <span className="num">
              {new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(contrato.inicio)}
            </span>
          }
        />
        {contrato.sinal?.usoMedioPct != null ? (
          <Campo
            rotulo="Uso médio da cota"
            valor={
              <span className={cn("num", estourando && "text-[var(--critico-tinta)]")}>
                {contrato.sinal.usoMedioPct.toFixed(0)}%
              </span>
            }
          />
        ) : null}
        <span className="num selo ml-auto">#{contrato.contratoConexaId}</span>
      </div>

      {contrato.fechados.some((c) => !c.conclusivo) ? (
        <div className="flex gap-2.5 border-b border-[var(--linha)] bg-[var(--wash-atencao)] px-4 py-2.5 text-[13.5px] leading-relaxed text-[var(--tinta-2)]">
          <span className="mt-px text-[var(--atencao-tinta)]" aria-hidden>
            ⚠
          </span>
          <p>
            <strong className="font-semibold text-[var(--tinta)]">Ciclos não conclusivos.</strong>{" "}
            Alguma reserva não pôde ser classificada — duração ausente ou status fora dos
            documentados. Esses ciclos não contam para o sinal: um ciclo com buraco não confirma nem
            nega estouro.
          </p>
        </div>
      ) : null}

      {linhas.length === 0 ? (
        <p className="px-4 py-4 text-[14px] text-[var(--tinta-3)]">Nenhum ciclo fechado ainda.</p>
      ) : (
        <TabelaCiclos linhas={linhas} temAtual={contrato.cicloAtual !== null} semCota={semCota} />
      )}
    </div>
  );
}

function Campo({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div>
      <div className="text-[12px] uppercase tracking-[0.04em] text-[var(--tinta-3)]">{rotulo}</div>
      <div className="mt-0.5 text-[14.5px] font-medium">{valor}</div>
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
    <Rolante>
      <table className="tabela">
        <thead>
          <tr>
            <th>Ciclo</th>
            <th className="text-right">Reservas</th>
            <th className="text-right">Abatido da cota</th>
            <th className="text-right">Faturado à parte</th>
            <th className="text-right">Não classificado</th>
            <th className="text-right">{semCota ? "Total" : "Saldo"}</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((c, i) => {
            const eAtual = temAtual && i === linhas.length - 1;
            return (
              <tr key={c.ciclo.rotulo + i} className={eAtual ? "linha-curso" : undefined}>
                <td className="whitespace-nowrap">
                  {c.ciclo.rotulo}
                  {eAtual ? <span className="selo selo-atencao ml-2">em curso</span> : null}
                </td>
                <td className="num text-right text-[var(--tinta-3)]">{c.reservas}</td>
                <td className="num text-right">{h(c.abatido)}</td>
                <td
                  className={cn(
                    "num text-right",
                    c.estourou && "font-semibold text-[var(--critico-tinta)]",
                  )}
                >
                  {h(c.faturado)}
                </td>
                <td className="num text-right text-[var(--tinta-3)]">
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
                <td className="num text-right font-medium">
                  {semCota ? h(c.consumido) : h(c.saldo)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Rolante>
  );
}
