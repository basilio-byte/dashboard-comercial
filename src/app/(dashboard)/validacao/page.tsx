import { usuarioAtual } from "@/lib/auth/session";
import { amostraDeValidacao } from "@/lib/intel/validar-horas";
import { Procedencia } from "@/components/Procedencia";

export const dynamic = "force-dynamic";

/**
 * Tela de VALIDAÇÃO do saldo de horas contra a tela do Conexa.
 *
 * O saldo é derivado, não lido. Esta tela existe para alguém conferir linha a
 * linha e responder uma pergunta binária: o número bate?
 *
 * Ela não valida sozinha — torna a validação possível, que é diferente.
 */
export default async function Validacao() {
  const usuario = await usuarioAtual();
  if (usuario?.role !== "ADMIN") {
    return <p className="text-sm text-neutral-500">Restrito a administradores.</p>;
  }

  const amostra = await amostraDeValidacao(20);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Validação do saldo de horas</h1>
        <p className="mt-1 text-sm text-neutral-500">
          O saldo é <strong>derivado</strong> (cota do plano menos as horas que o Conexa marcou como
          abatidas), com o ciclo ancorado na data de contratação. Esta tela existe para conferir
          esse número contra a tela do Conexa, cliente por cliente.
        </p>
      </div>

      <div className="rounded border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-700">
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
        <div className="rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>Amostra bloqueada.</strong> {amostra.bloqueio}
        </div>
      ) : amostra.linhas.length === 0 ? (
        <p className="text-sm text-neutral-500">
          Nenhum contrato ativo com cota de horas no espelho ainda.
        </p>
      ) : (
        <>
          <p className="text-sm text-neutral-500">
            {amostra.linhas.length} linhas, de {amostra.comCota} clientes com cota. Priorizadas as
            que tiveram movimento no ciclo — saldo intacto não exercita o cálculo.
          </p>

          <div className="overflow-x-auto rounded border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
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
              <tbody className="divide-y divide-neutral-100">
                {amostra.linhas.map((l) => (
                  <tr key={`${l.customerConexaId}-${l.contratoConexaId}`}>
                    <td className="px-3 py-2">
                      <span className="text-neutral-400">#{l.customerConexaId}</span>{" "}
                      {l.nome ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-neutral-600">{l.planoNome ?? "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-neutral-600">
                      {l.cicloInicio} a {l.cicloFim}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.concedido}h</td>
                    <td className="px-3 py-2 text-right tabular-nums text-neutral-500">
                      {l.reservasNoCiclo}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.abatido}h</td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.faturado}h</td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">
                      {l.saldoDerivado === null ? "—" : `${l.saldoDerivado}h`}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {!l.conclusivo ? (
                        <span className="text-amber-700" title={`${l.naoClassificado}h não classificadas`}>
                          não conclusivo
                        </span>
                      ) : l.ambiguo ? (
                        <span className="text-amber-700" title="Cliente tem mais de um contrato com cota">
                          atribuição ambígua
                        </span>
                      ) : (
                        <span className="text-neutral-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-neutral-500">
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
