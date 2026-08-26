import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatBRL, money } from "@/lib/money";
import { nowInAppTz, rotuloMes, ultimoMesFechado } from "@/lib/dates";
import { participacao, topClientes } from "@/lib/metrics/receita";
import { estadoDoEspelho } from "@/lib/intel/completude";
import { clientesComExcedente } from "@/lib/intel/horas";
import { Cartao, Secao, Vazio } from "@/components/Cartao";
import { Procedencia } from "@/components/Procedencia";
import { corVariacao, pct } from "@/lib/ui";

export const dynamic = "force-dynamic";

/**
 * RADAR — a fila de quem procurar hoje.
 *
 * ⚠ Esta tela responde *"quem eu devo procurar, e por quê?"*, **não** "quanto
 * faturamos". A segunda é a pergunta do dashboard financeiro; copiá-la aqui
 * transformaria um motor de oportunidades num relatório que ninguém abre.
 *
 * Daí a ordem: oportunidades primeiro; logo abaixo, o que o motor consegue e o
 * que não consegue — para uma fila vazia nunca ser ambígua; e a carteira por
 * último, como contexto para a conversa, não como manchete.
 */
export default async function Radar() {
  const agora = nowInAppTz();
  const anoCorrente = agora.getFullYear();
  const mesFechado = ultimoMesFechado(agora);

  const [espelho, ultimoSync, agregado, clientesAtivos] = await Promise.all([
    estadoDoEspelho(),
    prisma.syncRun.findFirst({
      where: { status: "SUCCESS" },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true },
    }),
    prisma.customerProfile.aggregate({
      where: { receitaAnoCorrente: { gt: 0 } },
      _sum: { receitaAnoCorrente: true },
      _count: true,
    }),
    prisma.customer.count({ where: { isActive: true, isBlocked: false } }),
  ]);

  // A fila LANÇA de propósito quando o espelho está incompleto, e o erro vira
  // conteúdo. Devolver lista vazia seria indistinguível de "ninguém tem sinal"
  // — a mentira mais cara que esta tela poderia contar.
  let fila: Awaited<ReturnType<typeof clientesComExcedente>> | null = null;
  let filaBloqueada: string | null = null;
  try {
    fila = await clientesComExcedente(agora, { limite: 200 });
  } catch (err) {
    filaBloqueada = err instanceof Error ? err.message : String(err);
  }

  const totalAno = money(agregado._sum.receitaAnoCorrente?.toString() ?? 0);
  const horasFmt = (v: { toFixed: (n: number) => string }) =>
    `${Number(v.toFixed(1))}h`.replace(".", ",");

  return (
    <div className="space-y-10">
      <Cabecalho mesFechado={mesFechado} sincronizadoEm={ultimoSync?.finishedAt ?? null} />

      <Secao
        titulo="Oportunidades"
        sub="Clientes com sinal de venda adicional, do mais forte para o mais fraco."
      >
        {filaBloqueada ? (
          <div className="faixa faixa-atencao">
            <strong>A fila ainda não pode ser calculada.</strong> {filaBloqueada}
          </div>
        ) : !fila || fila.itens.length === 0 ? (
          <Vazio>
            Nenhum cliente com sinal no momento.
            {fila?.ambiguos ? (
              <>
                {" "}
                <span className="text-[var(--atencao-tinta)]">
                  {fila.ambiguos} cliente(s) ficaram de fora por atribuição ambígua
                </span>{" "}
                — têm mais de um contrato com cota, e a reserva não diz de qual balde a hora saiu.
              </>
            ) : null}
          </Vazio>
        ) : (
          <div className="cartao overflow-hidden">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Motivo</th>
                  <th className="text-right">Horas pagas por fora</th>
                  <th className="text-right">Ciclos</th>
                </tr>
              </thead>
              <tbody>
                {fila.itens.slice(0, 12).map((i) => (
                  <tr key={i.customerConexaId}>
                    <td>
                      <Link
                        href={`/carteira/${i.customerConexaId}`}
                        className="font-medium hover:underline"
                      >
                        {i.nome ?? `Cliente ${i.customerConexaId}`}
                      </Link>
                    </td>
                    <td className="text-[var(--tinta-2)]">
                      Estoura a cota de horas com recorrência — candidato a upgrade
                    </td>
                    <td className="num text-right font-medium text-[var(--critico-tinta)]">
                      {horasFmt(i.horas.sinal!.horasExcedentes)}
                    </td>
                    <td className="num text-right text-[var(--tinta-2)]">
                      {i.horas.sinal!.ciclosComEstouro}/{i.horas.sinal!.ciclosConclusivos}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {fila.truncado ? (
              <p className="border-t border-[var(--linha)] px-4 py-2 text-xs text-[var(--atencao-tinta)]">
                A análise parou no limite — há mais clientes não avaliados.
              </p>
            ) : null}
          </div>
        )}
      </Secao>

      {/* O detalhamento dos gatilhos vive em tela própria — repetir aqui
          competiria com a fila, que é o produto desta tela. */}
      <div className="faixa faixa-info">
        Só <strong>um gatilho</strong> está ativo hoje. Veja em{" "}
        <Link href="/gatilhos" className="underline">
          Gatilhos
        </Link>{" "}
        o que falta para os outros — fila vazia só significa algo quando se sabe o que está ligado.
      </div>

      <Secao titulo="Contexto" sub="Números da carteira para embasar a conversa — não são o produto desta tela.">
        <div className="grid gap-3 sm:grid-cols-3">
          <Cartao
            rotulo="Clientes ativos"
            valor={clientesAtivos.toLocaleString("pt-BR")}
            contexto="elegíveis para oferta"
            procedencia="API"
            confiavel={espelho.entidades.find((e) => e.entidade === "customers")?.completa ?? false}
            detalheProcedencia="customer.isActive e isBlocked"
          />
          <Cartao
            rotulo={`Receita ${anoCorrente}`}
            valor={formatBRL(totalAno)}
            contexto={`${agregado._count} clientes faturados`}
            confiavel={espelho.receitaConfiavel}
            detalheProcedencia="Soma de cobranças por data de emissão"
          />
          <TopClientes confiavel={espelho.receitaConfiavel} total={totalAno} />
        </div>
        <QuedaDeReceita mesFechado={mesFechado} confiavel={espelho.receitaConfiavel} />
      </Secao>
    </div>
  );
}

function Cabecalho({
  mesFechado,
  sincronizadoEm,
}: {
  mesFechado: string;
  sincronizadoEm: Date | null;
}) {
  const horas = sincronizadoEm ? (Date.now() - sincronizadoEm.getTime()) / 3_600_000 : null;
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight">Radar</h1>
        <p className="mt-1 text-[14px] text-[var(--tinta-2)]">
          Quem procurar hoje, e por quê.
        </p>
      </div>
      <div className="text-[13px]">
        {sincronizadoEm === null ? (
          <span className="text-[var(--atencao-tinta)]">nunca sincronizado</span>
        ) : horas !== null && horas > 2 ? (
          <span className="text-[var(--atencao-tinta)]">sincronizado há {horas.toFixed(1)}h</span>
        ) : (
          <span className="text-[var(--tinta-3)]">
            sincronizado{" "}
            {new Intl.DateTimeFormat("pt-BR", { timeStyle: "short" }).format(sincronizadoEm)}
          </span>
        )}
      </div>
    </div>
  );
}

async function TopClientes({
  confiavel,
  total,
}: {
  confiavel: boolean;
  total: ReturnType<typeof money>;
}) {
  const perfis = await prisma.customerProfile.findMany({
    where: { receitaAnoCorrente: { gt: 0 } },
    select: {
      customerConexaId: true,
      receitaAnoCorrente: true,
      customer: { select: { name: true } },
    },
    orderBy: { receitaAnoCorrente: "desc" },
    take: 20,
  });

  const top = topClientes(
    perfis.map((p) => ({
      customerConexaId: p.customerConexaId,
      nome: p.customer?.name ?? null,
      receita: money(p.receitaAnoCorrente.toString()),
    })),
    5,
  );

  return (
    <div className="cartao px-4 py-3.5">
      <div className="text-[13px] text-[var(--tinta-2)]">Top 5 do ano</div>
      {!confiavel ? (
        <p className="mt-2 text-[13px] text-[var(--tinta-3)]">
          Indisponível: um ranking sobre carga parcial aponta o cliente errado.
        </p>
      ) : top.length === 0 ? (
        <p className="mt-2 text-[13px] text-[var(--tinta-3)]">Nenhum cliente com receita.</p>
      ) : (
        <ol className="mt-2 space-y-1">
          {top.map((c, i) => (
            <li key={c.customerConexaId} className="flex items-baseline gap-2 text-[13px]">
              <span className="w-3 text-[var(--tinta-3)]">{i + 1}</span>
              <Link
                href={`/carteira/${c.customerConexaId}`}
                className="flex-1 truncate hover:underline"
              >
                {c.nome ?? `Cliente ${c.customerConexaId}`}
              </Link>
              <span className="num text-[var(--tinta-3)]">
                {participacao(c.receita, total)?.toFixed(0) ?? "—"}%
              </span>
            </li>
          ))}
        </ol>
      )}
      <div className="mt-2.5">
        <Procedencia tipo={confiavel ? "DERIVADO" : "INDISPONIVEL"} />
      </div>
    </div>
  );
}

async function QuedaDeReceita({
  mesFechado,
  confiavel,
}: {
  mesFechado: string;
  confiavel: boolean;
}) {
  if (!confiavel) return null;

  const emQueda = await prisma.customerMonthlyRevenue.findMany({
    where: { mesKey: mesFechado, variacaoPct: { lte: -30 } },
    select: {
      customerConexaId: true,
      receita: true,
      variacaoPct: true,
      customer: { select: { name: true } },
    },
    orderBy: { variacaoPct: "asc" },
    take: 8,
  });

  if (emQueda.length === 0) return null;

  return (
    <div className="cartao overflow-hidden">
      <div className="border-b border-[var(--linha)] px-4 py-2.5 text-[13px] text-[var(--tinta-2)]">
        Queda de receita em {rotuloMes(mesFechado)} — entre quem tem mês anterior para comparar
      </div>
      <table className="tabela">
        <tbody>
          {emQueda.map((m) => (
            <tr key={m.customerConexaId}>
              <td>
                <Link href={`/carteira/${m.customerConexaId}`} className="hover:underline">
                  {m.customer?.name ?? `Cliente ${m.customerConexaId}`}
                </Link>
              </td>
              <td className={`num text-right ${corVariacao(Number(m.variacaoPct))}`}>
                {pct(Number(m.variacaoPct))}
              </td>
              <td className="num w-32 text-right">{formatBRL(m.receita.toString())}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
