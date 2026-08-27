import { prisma } from "@/lib/db";
import { dataHoraLocal } from "@/lib/dates";
import { Painel, Rolante, Secao } from "@/components/Cartao";
import { FormularioContato, RESULTADO_ESTILO } from "./formulario-contato";
import { cn } from "@/lib/ui";

/**
 * Histórico de contatos com o cliente.
 *
 * Sugestão do Diego: *"um campo para informar o último contato e quem fez"*.
 * Virou registro com histórico em vez de campo único — um campo só guarda a
 * última linha e apaga a anterior, e é exatamente a anterior que responde "já
 * ofertamos isso a ele?".
 */
export async function Contatos({ customerConexaId }: { customerConexaId: number }) {
  const contatos = await prisma.contato.findMany({
    where: { customerConexaId },
    orderBy: { contatoEm: "desc" },
    take: 20,
  });

  const ultimo = contatos[0];

  return (
    <Secao
      titulo="Contatos"
      sub="Quem falou com este cliente, quando, e no que deu."
      acao={
        ultimo ? (
          <span className="selo">
            último há {diasDesde(ultimo.contatoEm)} · {ultimo.quem}
          </span>
        ) : (
          <span className="selo selo-atencao">nunca contatado</span>
        )
      }
    >
      <FormularioContato customerConexaId={customerConexaId} />

      {contatos.length > 0 ? (
        <Painel
          rodape={
            <>
              O registro é <strong>manual e de propósito</strong>: o sistema nunca fala com o
              cliente, então só uma pessoa sabe que o contato aconteceu. Quando a camada de
              disparo entrar, isto vira a fonte de supressão — não reofertar a quem já recusou.
            </>
          }
        >
          <Rolante>
            <table className="tabela">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Quem</th>
                  <th>Resultado</th>
                  <th>Motivo</th>
                  <th>Nota</th>
                </tr>
              </thead>
              <tbody>
                {contatos.map((c) => {
                  const e = RESULTADO_ESTILO[c.resultado];
                  return (
                    <tr key={c.id}>
                      <td className="num whitespace-nowrap">
                        {fmtDia(c.contatoEm)}
                        {/* Registrado depois do fato é o normal — ninguém anota
                            na hora. Só mostra quando a diferença importa. */}
                        {diffDias(c.contatoEm, c.registradoEm) >= 1 ? (
                          <span
                            className="ml-1 text-[var(--tinta-3)]"
                            title={`Registrado em ${dataHoraLocal(c.registradoEm)}${c.registradoPor ? ` por ${c.registradoPor}` : ""}`}
                          >
                            ✎
                          </span>
                        ) : null}
                      </td>
                      <td className="font-medium">{c.quem}</td>
                      <td>
                        <span className={cn("selo whitespace-nowrap", e?.classe)}>
                          {e?.rotulo ?? c.resultado}
                        </span>
                      </td>
                      <td className="text-[var(--tinta-2)]">
                        {c.regra ? (
                          <span className="selo">
                            {c.regra === "extra" || c.regra === "métrica"
                              ? c.regra
                              : `regra ${c.regra}`}
                          </span>
                        ) : (
                          <span className="text-[var(--tinta-3)]">—</span>
                        )}
                      </td>
                      <td className="max-w-sm text-[13px] text-[var(--tinta-3)]">
                        {c.nota ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Rolante>
        </Painel>
      ) : null}
    </Secao>
  );
}

function fmtDia(d: Date): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(d);
}

function diffDias(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000);
}

function diasDesde(d: Date): string {
  const n = Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
  if (n === 0) return "hoje";
  if (n === 1) return "1 dia";
  return `${n} dias`;
}
