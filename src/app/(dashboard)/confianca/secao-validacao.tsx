import { amostraDeValidacao } from "@/lib/intel/validar-horas";
import { Procedencia } from "@/components/Procedencia";
import { Faixa, Nota, Painel, Rolante } from "@/components/Cartao";

/**
 * Tela de VALIDAÇÃO do saldo de horas contra a tela do Conexa.
 *
 * O saldo é derivado, não lido. Esta tela existe para alguém conferir linha a
 * linha e responder uma pergunta binária: o número bate?
 *
 * Ela não valida sozinha — torna a validação possível, que é diferente.
 */
export async function SecaoValidacao() {
  const amostra = await amostraDeValidacao(20);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[17px] font-semibold tracking-tight">Validação do saldo de horas</h2>
        <p className="mt-1 max-w-3xl text-[13.5px] leading-relaxed text-[var(--tinta-2)]">
          O saldo é <strong className="font-semibold text-[var(--tinta)]">derivado</strong> (cota do
          plano menos as horas que o Conexa marcou como abatidas), com o ciclo ancorado na data de
          contratação. Esta tela existe para conferir esse número contra a tela do Conexa, cliente
          por cliente.
        </p>
      </div>

      {/* O protocolo da conferência, em três passos. Antes eram três parágrafos
          seguidos num cartão só, e o critério de aprovação — a parte que decide
          se dois gatilhos ligam — não se distinguia do resto. */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Instrucao n={1} titulo="Como conferir">
          Para cada linha, abrir o cliente no Conexa, olhar o pacote de horas do ciclo indicado e
          comparar o <strong>saldo</strong>. Anotar apenas se bate ou não — a diferença exata importa
          menos que o acerto do sinal.
        </Instrucao>
        <Instrucao n={2} titulo="Critério de aprovação">
          100% de concordância no <strong>sinal do gatilho</strong>. Errar 30 minutos num saldo de
          20h é irrelevante; o que não pode é o derivado dizer &quot;abaixo do limiar&quot; com o
          Conexa dizendo &quot;acima&quot;.
        </Instrucao>
        <Instrucao n={3} titulo="Reprovar é resultado válido">
          Se não bater, as regras de saldo (2 e 9) ficam desligadas e a lacuna é documentada com
          números — em vez de o sistema ofertar pacote para quem tem 20h sobrando.
        </Instrucao>
      </div>

      {amostra.bloqueio ? (
        <Faixa tom="atencao">
          <strong>Amostra bloqueada.</strong> {amostra.bloqueio}
        </Faixa>
      ) : amostra.linhas.length === 0 ? (
        <Nota>Nenhum contrato ativo com cota de horas no espelho ainda.</Nota>
      ) : (
        <>
          <Painel
            titulo={
              <>
                {amostra.linhas.length} linhas, de {amostra.comCota} clientes com cota
                <span className="text-[var(--tinta-3)]">
                  {" "}
                  · priorizadas as que tiveram movimento no ciclo
                </span>
              </>
            }
            rodape={
              <>
                <Procedencia tipo="API" detalhe="plan.hourQuotas" /> cota ·{" "}
                <Procedencia tipo="API" detalhe="booking.status = deductedFromQuota" /> abatido ·{" "}
                <Procedencia tipo="DERIVADO" detalhe="cota − abatido" /> saldo. Linha marcada como{" "}
                <strong>não conclusiva</strong> tem reserva que não pudemos classificar e{" "}
                <strong>não deve ser usada</strong> para aprovar ou reprovar o cálculo.
              </>
            }
          >
            <Rolante>
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Plano</th>
                    <th>Ciclo</th>
                    <th className="text-right">Cota</th>
                    <th className="text-right">Res.</th>
                    <th className="text-right">Abatido</th>
                    <th className="text-right">Faturado</th>
                    <th className="text-right">Saldo derivado</th>
                    <th>Ressalva</th>
                  </tr>
                </thead>
                <tbody>
                  {amostra.linhas.map((l) => (
                    <tr key={`${l.customerConexaId}-${l.contratoConexaId}`}>
                      <td>
                        <span className="num text-[var(--tinta-3)]">#{l.customerConexaId}</span>{" "}
                        {l.nome ?? "—"}
                      </td>
                      <td className="text-[var(--tinta-2)]">{l.planoNome ?? "—"}</td>
                      <td className="num whitespace-nowrap text-[var(--tinta-2)]">
                        {l.cicloInicio} a {l.cicloFim}
                      </td>
                      <td className="num text-right">{l.concedido}h</td>
                      <td className="num text-right text-[var(--tinta-3)]">{l.reservasNoCiclo}</td>
                      <td className="num text-right">{l.abatido}h</td>
                      <td className="num text-right">{l.faturado}h</td>
                      <td className="num text-right font-semibold">
                        {l.saldoDerivado === null ? "—" : `${l.saldoDerivado}h`}
                      </td>
                      <td>
                        {!l.conclusivo ? (
                          <span
                            className="selo selo-atencao"
                            title={`${l.naoClassificado}h não classificadas`}
                          >
                            não conclusivo
                          </span>
                        ) : l.ambiguo ? (
                          <span
                            className="selo selo-atencao"
                            title="Cliente tem mais de um contrato com cota"
                          >
                            ambíguo
                          </span>
                        ) : (
                          <span className="text-[var(--tinta-3)]">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Rolante>
          </Painel>
        </>
      )}
    </div>
  );
}

function Instrucao({
  n,
  titulo,
  children,
}: {
  n: number;
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="cartao px-4 py-3.5">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="num flex h-5 w-5 items-center justify-center rounded-full bg-[var(--acento-wash)] text-[11px] font-semibold text-[var(--acento-tinta)]"
        >
          {n}
        </span>
        <span className="text-[13px] font-semibold">{titulo}</span>
      </div>
      <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--tinta-2)]">{children}</p>
    </div>
  );
}
