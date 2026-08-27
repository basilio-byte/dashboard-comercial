import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Wallet, CalendarRange, Clock } from "lucide-react";
import { prisma } from "@/lib/db";
import { formatBRL } from "@/lib/money";
import { cotaMensalDoContratoRaw } from "@/lib/conexa/mappers";
import { currentMonthKey, rotuloMes, ultimosMesesFechados } from "@/lib/dates";
import { Lacuna, Procedencia } from "@/components/Procedencia";
import { corVariacao, pct } from "@/lib/ui";
import { estadoDoEspelho } from "@/lib/intel/completude";
import { horasDoCliente } from "@/lib/intel/horas";
import { BlocoHoras } from "@/components/Horas";
import { SinaisAutomaticos } from "./sinais";
import { Contatos } from "./contatos";
import { Cartao, Faixa, Painel, Rolante, Secao, Vazio } from "@/components/Cartao";

export const dynamic = "force-dynamic";

export default async function ClienteDetalhe({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const conexaId = Number(id);
  if (!Number.isInteger(conexaId)) notFound();

  const [cliente, perfil, mensais, contratos, horas, espelho] = await Promise.all([
    prisma.customer.findUnique({ where: { conexaId } }),
    prisma.customerProfile.findUnique({ where: { customerConexaId: conexaId } }),
    prisma.customerMonthlyRevenue.findMany({
      where: { customerConexaId: conexaId },
      orderBy: { mesKey: "asc" },
    }),
    prisma.contract.findMany({
      where: { customerConexaId: conexaId },
      orderBy: [{ isActive: "desc" }, { startDate: "desc" }],
    }),
    horasDoCliente(conexaId),
    estadoDoEspelho(),
  ]);

  if (!cliente) notFound();

  const mesCorrente = currentMonthKey();
  const doze = ultimosMesesFechados(12);
  const serie = mensais.filter((m) => doze.includes(m.mesKey) || m.mesKey === mesCorrente);
  const planoIds = [
    ...new Set(contratos.map((c) => c.planConexaId).filter((x): x is number => x !== null)),
  ];
  const planos = planoIds.length
    ? await prisma.plan.findMany({ where: { conexaId: { in: planoIds } } })
    : [];
  const planoPorId = new Map(planos.map((p) => [p.conexaId, p]));

  const inelegivel = !cliente.isActive || cliente.isBlocked;

  return (
    <>
      <div className="mb-7">
        <Link
          href="/carteira"
          className="inline-flex items-center gap-1.5 text-[13.5px] text-[var(--tinta-3)] transition-colors hover:text-[var(--tinta)]"
        >
          <ArrowLeft size={13} />
          Carteira
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="titulo-pagina">{cliente.name ?? `Cliente ${conexaId}`}</h1>
          <span className="num selo">#{conexaId}</span>
          {inelegivel ? (
            <span className="selo selo-atencao">
              {cliente.isBlocked ? "bloqueado" : "inativo"}
            </span>
          ) : null}
        </div>
      </div>

      <div className="space-y-9">
        {inelegivel ? (
          <Faixa tom="atencao">
            Cliente {cliente.isBlocked ? "bloqueado" : "inativo"} no Conexa —{" "}
            <strong>não é elegível</strong> para oferta. Ver ADR-0010.
          </Faixa>
        ) : null}

        <section className="grid gap-3 sm:grid-cols-3">
          <Cartao
            rotulo="Receita no ano"
            Icone={Wallet}
            valor={formatBRL(perfil?.receitaAnoCorrente?.toString() ?? 0)}
            confiavel={espelho.receitaConfiavel}
            contexto="regime de emissão"
            detalheProcedencia="Soma de cobranças por data de emissão"
          />
          <Cartao
            rotulo="Receita 12 meses"
            Icone={CalendarRange}
            valor={formatBRL(perfil?.receita12Meses?.toString() ?? 0)}
            confiavel={espelho.receitaConfiavel}
            contexto="meses fechados"
            detalheProcedencia="Soma de cobranças por data de emissão"
          />
          <div className="cartao flex flex-col px-4 py-3.5">
            <div className="flex items-center gap-1.5 text-[13.5px] font-medium text-[var(--tinta-2)]">
              <Clock size={13.5} className="shrink-0 text-[var(--tinta-3)]" />
              Horas inclusas por mês
              {perfil?.contratosAtivos != null && perfil.contratosAtivos > 1 ? (
                <span
                  className="selo selo-atencao"
                  title="Soma das cotas de todos os contratos ativos deste cliente. As cotas podem ser de baldes diferentes, e nesse caso a soma não é um saldo único."
                >
                  soma de {perfil.contratosAtivos}
                </span>
              ) : null}
            </div>
            <div className="num mt-2 text-[27px] font-semibold leading-none tracking-[-0.02em]">
              {perfil?.horasInclusasMes != null ? (
                `${Number(perfil.horasInclusasMes)}h`
              ) : perfil?.temContratoAtivo ? (
                <span className="text-[19px] text-[var(--tinta-3)]">sem cota</span>
              ) : (
                <span className="text-[19px]">
                  <Lacuna motivo="Cliente sem contrato ativo — não há plano de onde ler a cota" />
                </span>
              )}
            </div>
            <div className="mt-auto flex items-center gap-2 pt-3 text-[12.5px] text-[var(--tinta-3)]">
              <Procedencia tipo="API" detalhe="plan.hourQuotas" />
              <span className="truncate">
                {perfil?.horasInclusasMes == null && perfil?.temContratoAtivo
                  ? "plano sem horas inclusas (não é zero)"
                  : "concessão do plano"}
              </span>
            </div>
          </div>
        </section>

        <SinaisAutomaticos customerConexaId={conexaId} />

        <Contatos customerConexaId={conexaId} />

        <Secao titulo="Receita mês a mês">
          {serie.length === 0 ? (
            <Vazio>Sem receita registrada no período.</Vazio>
          ) : (
            <Painel
              rodape={
                <>
                  O traço na variação significa <strong>mês anterior sem receita</strong> — não é
                  queda de 100%. O mês em curso aparece para consulta e <strong>nunca</strong>{" "}
                  alimenta alerta de tendência.
                </>
              }
            >
              <Rolante>
                <table className="tabela">
                  <thead>
                    <tr>
                      <th>Mês</th>
                      <th className="text-right">Cobranças</th>
                      <th className="text-right">Receita</th>
                      <th className="text-right">Variação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {serie.map((m) => (
                      <tr
                        key={m.mesKey}
                        className={m.mesKey === mesCorrente ? "linha-curso" : undefined}
                      >
                        <td>
                          {rotuloMes(m.mesKey)}
                          {m.mesKey === mesCorrente ? (
                            <span className="selo selo-atencao ml-2">em curso · incompleto</span>
                          ) : null}
                        </td>
                        <td className="num text-right text-[var(--tinta-3)]">{m.cobrancas}</td>
                        <td className="num text-right font-medium">
                          {formatBRL(m.receita.toString())}
                        </td>
                        <td
                          className={`num text-right ${corVariacao(
                            m.variacaoPct === null ? null : Number(m.variacaoPct),
                          )}`}
                          title={
                            m.variacaoPct === null
                              ? "Mês anterior sem receita — não existe variação percentual"
                              : undefined
                          }
                        >
                          {pct(m.variacaoPct === null ? null : Number(m.variacaoPct))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Rolante>
            </Painel>
          )}
        </Secao>

        <Secao titulo="Horas de sala por ciclo">
          <BlocoHoras dados={horas} confiavel={espelho.horasConfiavel} />
        </Secao>

        <Secao titulo="Contratos">
          {contratos.length === 0 ? (
            <Vazio>Nenhum contrato.</Vazio>
          ) : (
            <Painel>
              <Rolante>
                <table className="tabela">
                  <thead>
                    <tr>
                      <th>Plano</th>
                      <th>Início</th>
                      <th>Fim</th>
                      <th className="text-right">Horas/mês</th>
                      <th className="text-right">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contratos.map((c) => {
                      const plano =
                        c.planConexaId !== null ? planoPorId.get(c.planConexaId) : undefined;
                      return (
                        <tr key={c.conexaId} className={c.isActive ? undefined : "opacity-55"}>
                          <td className="font-medium">
                            {plano?.name ?? c.contractSummary ?? `Plano ${c.planConexaId ?? "?"}`}
                            {!c.isActive ? <span className="selo ml-2">encerrado</span> : null}
                          </td>
                          <td className="num text-[var(--tinta-2)]">{fmtData(c.startDate)}</td>
                          <td className="num text-[var(--tinta-2)]">{fmtData(c.endDate)}</td>
                          <td className="num text-right">
                            {/* ⚠ O CONTRATO manda, o plano é o padrão — é o que
                                `concessaoDoContrato` faz, e ler só o plano aqui
                                marcava "sem cota" contrato que declara a sua
                                própria. Foi exatamente o defeito que produziu
                                saldo negativo em produção, sobrevivendo nesta
                                célula depois de corrigido no cálculo. */}
                            {Array.isArray(c.hourPlanQuotaRaw) && c.hourPlanQuotaRaw.length > 0 ? (
                              <span title="Cota declarada no próprio contrato, que tem precedência sobre a do plano">
                                {`${cotaMensalDoContratoRaw(c.hourPlanQuotaRaw) ?? "—"}h`}
                              </span>
                            ) : plano?.horasInclusasMes != null ? (
                              `${Number(plano.horasInclusasMes)}h`
                            ) : (
                              <span className="text-[var(--tinta-3)]">sem cota</span>
                            )}
                          </td>
                          <td className="num text-right font-medium">
                            {formatBRL(c.amount.toString())}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Rolante>
            </Painel>
          )}
        </Secao>
      </div>
    </>
  );
}

function fmtData(d: Date | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(d);
}

