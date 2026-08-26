import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatBRL, money, roundMoney, sum } from "@/lib/money";
import { nowInAppTz, rotuloMes, ultimoMesFechado, ultimosMesesFechados } from "@/lib/dates";
import { participacao, topClientes } from "@/lib/metrics/receita";
import { Procedencia } from "@/components/Procedencia";
import { corVariacao, pct } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function Panorama() {
  const agora = nowInAppTz();
  const anoCorrente = agora.getFullYear();
  const mesFechado = ultimoMesFechado(agora);
  const doze = ultimosMesesFechados(12, agora);

  const [perfis, mensaisMes, ultimoSync] = await Promise.all([
    prisma.customerProfile.findMany({
      where: { receitaAnoCorrente: { gt: 0 } },
      select: { customerConexaId: true, receitaAnoCorrente: true, customer: { select: { name: true } } },
      orderBy: { receitaAnoCorrente: "desc" },
      take: 200,
    }),
    prisma.customerMonthlyRevenue.findMany({
      where: { mesKey: mesFechado },
      select: { customerConexaId: true, receita: true, variacaoPct: true, customer: { select: { name: true } } },
    }),
    prisma.syncRun.findFirst({
      where: { status: "SUCCESS" },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true, mode: true },
    }),
  ]);

  const semDados = perfis.length === 0 && mensaisMes.length === 0;

  const top5 = topClientes(
    perfis.map((p) => ({
      customerConexaId: p.customerConexaId,
      nome: p.customer?.name ?? null,
      receita: money(p.receitaAnoCorrente.toString()),
    })),
    5,
  );
  const totalAno = roundMoney(sum(perfis.map((p) => p.receitaAnoCorrente.toString())));
  const totalMes = roundMoney(sum(mensaisMes.map((m) => m.receita.toString())));

  // "Em queda" só considera quem TEM base de comparação. variacaoPct nulo =
  // mês anterior zerado = estreante ou retorno, não queda.
  const emQueda = mensaisMes
    .filter((m) => m.variacaoPct !== null && Number(m.variacaoPct) <= -30)
    .sort((a, b) => Number(a.variacaoPct) - Number(b.variacaoPct))
    .slice(0, 10);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Panorama</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Último mês fechado: <strong>{rotuloMes(mesFechado)}</strong>
          {ultimoSync?.finishedAt ? (
            <> · sincronizado {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(ultimoSync.finishedAt)}</>
          ) : (
            <> · <span className="text-amber-700">nunca sincronizado</span></>
          )}
        </p>
      </div>

      {semDados ? (
        <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>Sem dados ainda.</strong> Rode a primeira carga em{" "}
          <Link href="/operacao" className="underline">
            Operação
          </Link>
          . Até lá as telas ficam vazias de propósito — nenhum número inventado.
        </div>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2">
        <Cartao
          titulo={`Receita ${anoCorrente}`}
          valor={formatBRL(totalAno)}
          nota={`${perfis.length} clientes com receita`}
        />
        <Cartao
          titulo={`Receita de ${rotuloMes(mesFechado)}`}
          valor={formatBRL(totalMes)}
          nota={`${mensaisMes.length} clientes faturados`}
        />
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Top 5 clientes · {anoCorrente}
        </h2>
        {top5.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-500">Nenhum cliente com receita no ano.</p>
        ) : (
          <ol className="mt-3 divide-y divide-neutral-200 rounded border border-neutral-200 bg-white">
            {top5.map((c, i) => (
              <li key={c.customerConexaId} className="flex items-center gap-3 px-4 py-3">
                <span className="w-5 text-sm text-neutral-400">{i + 1}</span>
                <Link href={`/clientes/${c.customerConexaId}`} className="flex-1 text-sm hover:underline">
                  {c.nome ?? `Cliente ${c.customerConexaId}`}
                </Link>
                <span className="text-sm text-neutral-500">
                  {participacao(c.receita, totalAno)?.toFixed(1).replace(".", ",") ?? "—"}%
                </span>
                <span className="w-32 text-right text-sm font-medium tabular-nums">
                  {formatBRL(c.receita)}
                </span>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-2 text-xs text-neutral-500">
          <Procedencia tipo="DERIVADO" detalhe="Soma de cobranças por data de emissão, régua do ADR-0006" />{" "}
          regime de emissão, valor com juros e multa; canceladas e negociadas fora.
        </p>
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Queda de receita em {rotuloMes(mesFechado)}
        </h2>
        {emQueda.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-500">
            Nenhum cliente com queda de 30% ou mais — entre os que têm mês anterior para comparar.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-neutral-200 rounded border border-neutral-200 bg-white">
            {emQueda.map((m) => (
              <li key={m.customerConexaId} className="flex items-center gap-3 px-4 py-3">
                <Link href={`/clientes/${m.customerConexaId}`} className="flex-1 text-sm hover:underline">
                  {m.customer?.name ?? `Cliente ${m.customerConexaId}`}
                </Link>
                <span className={`text-sm tabular-nums ${corVariacao(Number(m.variacaoPct))}`}>
                  {pct(Number(m.variacaoPct))}
                </span>
                <span className="w-32 text-right text-sm tabular-nums">{formatBRL(m.receita.toString())}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-neutral-500">
          Compara {rotuloMes(mesFechado)} com {rotuloMes(doze[doze.length - 2] ?? "")}. Cliente sem receita no
          mês anterior <strong>não</strong> aparece aqui: sem base não existe queda percentual.
        </p>
      </section>
    </div>
  );
}

function Cartao({ titulo, valor, nota }: { titulo: string; valor: string; nota: string }) {
  return (
    <div className="rounded border border-neutral-200 bg-white px-4 py-3">
      <div className="text-sm text-neutral-500">{titulo}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{valor}</div>
      <div className="mt-1 flex items-center gap-2 text-xs text-neutral-500">
        <Procedencia tipo="DERIVADO" />
        {nota}
      </div>
    </div>
  );
}
