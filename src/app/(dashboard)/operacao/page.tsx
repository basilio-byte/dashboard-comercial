import { prisma } from "@/lib/db";
import { getEnv, conexaConfigurado } from "@/lib/env";
import { usuarioAtual } from "@/lib/auth/session";
import { backfillPendente } from "@/lib/conexa/sync";
import { PainelOperacao } from "./painel";

export const dynamic = "force-dynamic";

export default async function Operacao() {
  const env = getEnv();
  const usuario = await usuarioAtual();
  const admin = usuario?.role === "ADMIN";

  const [runs, pendentes, contagens] = await Promise.all([
    prisma.syncRun.findMany({ orderBy: { startedAt: "desc" }, take: 15 }),
    backfillPendente(),
    Promise.all([
      prisma.customer.count(),
      prisma.contract.count(),
      prisma.charge.count(),
      prisma.sale.count(),
      prisma.plan.count(),
    ]),
  ]);
  const [clientes, contratos, cobrancas, vendas, planos] = contagens;

  const ultimoSucesso = runs.find((r) => r.status === "SUCCESS" && r.finishedAt);
  const horasDesdeSync = ultimoSucesso?.finishedAt
    ? (Date.now() - ultimoSucesso.finishedAt.getTime()) / 3_600_000
    : null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Operação</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Estado da integração com o Conexa. Somente leitura — este sistema nunca escreve no ERP.
        </p>
      </div>

      {!conexaConfigurado() ? (
        <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>Sem token do Conexa.</strong> Configure <code>CONEXA_API_TOKEN</code> nas variáveis de
          ambiente do serviço. Nada sincroniza até lá.
        </div>
      ) : null}

      {horasDesdeSync !== null && horasDesdeSync > 2 ? (
        <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Última sincronização bem-sucedida há <strong>{horasDesdeSync.toFixed(1)}h</strong>. Acima de 2h,
          os números da tela podem estar velhos.
        </div>
      ) : null}

      {pendentes.length ? (
        <div className="rounded border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          <strong>Backfill em andamento</strong> ({pendentes.join(", ")}). O cursor está salvo — rodar de
          novo continua de onde parou, não recomeça.
        </div>
      ) : null}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Contador rotulo="Clientes" n={clientes} />
        <Contador rotulo="Contratos" n={contratos} />
        <Contador rotulo="Cobranças" n={cobrancas} />
        <Contador rotulo="Vendas" n={vendas} />
        <Contador rotulo="Planos" n={planos} />
      </section>

      <section className="rounded border border-neutral-200 bg-white px-4 py-3 text-sm">
        <h2 className="font-medium">Configuração</h2>
        <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-neutral-600 sm:grid-cols-3">
          <Item termo="Ritmo do Conexa" valor={`${env.CONEXA_RATE_LIMIT_PER_MIN} req/min`} />
          <Item termo="Fuso" valor={env.APP_TIMEZONE} />
          <Item termo="Agendador de leitura" valor={env.SYNC_SCHEDULER} />
          <Item termo="Agendador de inteligência" valor={env.INTEL_SCHEDULER} />
          <Item termo="Disparo" valor={env.NOTIFICADOR} />
          <Item termo="Modo de disparo" valor={env.NOTIFICADOR_MODO} />
        </dl>
        <p className="mt-2 text-xs text-neutral-500">
          O teto de 60 req/min do Conexa é da <strong>conta</strong> e é dividido com o Dashboard
          Financeiro, que já roda em produção. Por isso o ritmo aqui é conservador. Ver ADR-0002.
        </p>
      </section>

      {admin ? (
        <PainelOperacao />
      ) : (
        <p className="text-sm text-neutral-500">Ações de sincronização são restritas a administradores.</p>
      )}

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Execuções recentes</h2>
        {runs.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-500">Nenhuma execução ainda.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Quando</th>
                  <th className="px-4 py-2 font-medium">Modo</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 text-right font-medium">Lidos</th>
                  <th className="px-4 py-2 text-right font-medium">Gravados</th>
                  <th className="px-4 py-2 text-right font-medium">Req.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2 whitespace-nowrap text-neutral-600">
                      {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(
                        r.startedAt,
                      )}
                    </td>
                    <td className="px-4 py-2">{r.mode}</td>
                    <td className="px-4 py-2">
                      <Estado status={r.status} />
                      {r.error ? <div className="mt-1 text-xs text-red-700">{r.error}</div> : null}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.recordsRead}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.recordsWrote}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.requestsMade}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-neutral-500">
          <strong>HALTED</strong> não é falha: é o freio de páginas por execução ou um encerramento pedido.
          O cursor guarda o ponto e a próxima execução continua dali.
        </p>
      </section>
    </div>
  );
}

function Contador({ rotulo, n }: { rotulo: string; n: number }) {
  return (
    <div className="rounded border border-neutral-200 bg-white px-3 py-2">
      <div className="text-xs text-neutral-500">{rotulo}</div>
      <div className="text-lg font-semibold tabular-nums">{n.toLocaleString("pt-BR")}</div>
    </div>
  );
}

function Item({ termo, valor }: { termo: string; valor: string }) {
  return (
    <div>
      <dt className="text-xs text-neutral-500">{termo}</dt>
      <dd className="font-medium text-neutral-800">{valor}</dd>
    </div>
  );
}

function Estado({ status }: { status: string }) {
  const cor =
    status === "SUCCESS"
      ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
      : status === "FAILED"
        ? "bg-red-50 text-red-800 ring-red-200"
        : status === "HALTED"
          ? "bg-sky-50 text-sky-800 ring-sky-200"
          : "bg-neutral-100 text-neutral-700 ring-neutral-300";
  return (
    <span className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ring-1 ring-inset ${cor}`}>
      {status}
    </span>
  );
}
