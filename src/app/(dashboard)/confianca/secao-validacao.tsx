import { amostraDeValidacao } from "@/lib/intel/validar-horas";
import { Procedencia } from "@/components/Procedencia";

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
    <div className="space-y-6">
      <div>
        <h2 className="text-[17px] font-semibold tracking-tight">Validação do saldo de horas</h2>
        <p className="mt-1 text-sm text-[var(--tinta-2)]">
          O saldo é <strong>derivado</strong> (cota do plano menos as horas que o Conexa marcou como
          abatidas), com o ciclo ancorado na data de contratação. Esta tela existe para conferir
          esse número contra a tela do Conexa, cliente por cliente.
        </p>
      </div>

      <div className="cartao px-4 py-3 text-sm text-[var(--tinta-2)]">
        <p>
          <strong>Como conferir.</strong> Para cada linha, abrir o cliente no Conexa, olhar o pacote
          de horas do ciclo indicado e comparar o <strong>saldo</strong>. Anotar apenas se bate ou
          não — a diferença exata importa menos que o acerto do sinal.
        </p>
        <p className="mt-2">
          <strong>Critério de aprovação:</strong> 100% de concordância no <strong>sinal do
          gatilho</strong>. Errar 30 minutos num saldo de 20h é irrelevante; o que não pode é o
          derivado dizer &quot;abaixo do limiar&quot; com o Conexa dizendo &quot;acima&quot;.
        </p>
        <p className="mt-2">
          <strong>Reprovar é resultado válido.</strong> Se não bater, as regras de saldo (2 e 9)
          ficam desligadas e a lacuna é documentada com números — em vez de o sistema ofertar pacote
          para quem tem 20h sobrando.
        </p>
      </div>

      {amostra.bloqueio ? (
        <div className="rounded border border-[color-mix(in_oklab,var(--atencao)_35%,transparent)] bg-[var(--wash-atencao)] px-4 py-3 text-sm text-[var(--atencao-tinta)]">
          <strong>Amostra bloqueada.</strong> {amostra.bloqueio}
        </div>
      ) : amostra.linhas.length === 0 ? (
        <p className="text-sm text-[var(--tinta-3)]">
          Nenhum contrato ativo com cota de horas no espelho ainda.
        </p>
      ) : (
        <>
          <p className="text-sm text-[var(--tinta-3)]">
            {amostra.linhas.length} linhas, de {amostra.comCota} clientes com cota. Priorizadas as
            que tiveram movimento no ciclo — saldo intacto não exercita o cálculo.
          </p>

          <div className="overflow-x-auto cartao">
            <table className="tabela">
              <thead className="border-b border-[var(--linha)] text-left text-xs uppercase tracking-wide text-[var(--tinta-3)]">
                <tr>
                  <th className="px-3 py-2 font-medium">Cliente</th>
                  <th className="px-3 py-2 font-medium">Plano</th>
                  <th className="px-3 py-2 font-medium">Ciclo</th>
                  <th className="px-3 py-2 text-right font-medium">Cota</th>
                  <th className="px-3 py-2 text-right font-medium">Res.</th>
                  <th className="px-3 py-2 text-right font-medium">Abatido</th>
                  <th className="px-3 py-2 text-right font-medium">Faturado</th>
                  <th className="px-3 py-2 text-right font-medium">Saldo derivado</th>
                  <th className="px-3 py-2 font-medium">Ressalva</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--linha)]">
                {amostra.linhas.map((l) => (
                  <tr key={`${l.customerConexaId}-${l.contratoConexaId}`}>
                    <td className="px-3 py-2">
                      <span className="text-[var(--tinta-3)]">#{l.customerConexaId}</span>{" "}
                      {l.nome ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-[var(--tinta-2)]">{l.planoNome ?? "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-[var(--tinta-2)]">
                      {l.cicloInicio} a {l.cicloFim}
                    </td>
                    <td className="px-3 py-2 text-right num">{l.concedido}h</td>
                    <td className="px-3 py-2 text-right num text-[var(--tinta-3)]">
                      {l.reservasNoCiclo}
                    </td>
                    <td className="px-3 py-2 text-right num">{l.abatido}h</td>
                    <td className="px-3 py-2 text-right num">{l.faturado}h</td>
                    <td className="px-3 py-2 text-right font-medium num">
                      {l.saldoDerivado === null ? "—" : `${l.saldoDerivado}h`}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {!l.conclusivo ? (
                        <span className="text-[var(--atencao-tinta)]" title={`${l.naoClassificado}h não classificadas`}>
                          não conclusivo
                        </span>
                      ) : l.ambiguo ? (
                        <span className="text-[var(--atencao-tinta)]" title="Cliente tem mais de um contrato com cota">
                          atribuição ambígua
                        </span>
                      ) : (
                        <span className="text-[var(--tinta-3)]">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-[var(--tinta-3)]">
            <Procedencia tipo="API" detalhe="plan.hourQuotas" /> cota ·{" "}
            <Procedencia tipo="API" detalhe="booking.status = deductedFromQuota" /> abatido ·{" "}
            <Procedencia tipo="DERIVADO" detalhe="cota − abatido" /> saldo. Linha marcada como{" "}
            <strong>não conclusiva</strong> tem reserva que não pudemos classificar e{" "}
            <strong>não deve ser usada</strong> para aprovar ou reprovar o cálculo.
          </p>
        </>
      )}
    </div>
  );
}
