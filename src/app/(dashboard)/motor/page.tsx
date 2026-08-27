import { prisma } from "@/lib/db";
import { getEnv, conexaConfigurado } from "@/lib/env";
import { usuarioAtual } from "@/lib/auth/session";
import { coberturaDeProdutos, progressoDaCarga, pulsoDaCarga } from "@/lib/conexa/sync-janelas";
import { dataHoraLocal } from "@/lib/dates";
import { PainelOperacao } from "./painel";
import { Pulso } from "./pulso";
import { Cabecalho, Faixa, Nota, Painel, Rolante, Secao, Vazio } from "@/components/Cartao";
import { cn } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function Motor() {
  const env = getEnv();
  const usuario = await usuarioAtual();
  const admin = usuario?.role === "ADMIN";

  const [runs, progresso, pulso, produtos, contagens] = await Promise.all([
    prisma.syncRun.findMany({ orderBy: { startedAt: "desc" }, take: 15 }),
    progressoDaCarga(),
    pulsoDaCarga(),
    coberturaDeProdutos(),
    Promise.all([
      prisma.customer.count(),
      prisma.contract.count(),
      prisma.charge.count(),
      prisma.sale.count(),
      prisma.plan.count(),
    ]),
  ]);
  const [clientes, contratos, cobrancas, vendas, planos] = contagens;

  /**
   * ⚠ Consulta PRÓPRIA, e filtrada por modo — não uma varredura dos 15 runs
   * exibidos na tabela.
   *
   * Dois defeitos de uma vez, na versão anterior:
   *
   * 1. `runs.find(r => r.status === "SUCCESS")` pegava `intelligence`, que roda
   *    a cada 30 min e **não toca na API**. O aviso "os números podem estar
   *    velhos" nunca aparecia, porque o relógio da consolidação estava sempre
   *    fresco. O aviso existia e era estruturalmente incapaz de disparar.
   * 2. Procurar dentro de `take: 15` significa que, num dia de muitas
   *    execuções, a última leitura real cai fora da fatia e o aviso volta a
   *    sumir — por um motivo diferente e ainda mais difícil de ver.
   *
   * `HALTED` conta como progresso: o próprio rodapé desta tela explica que
   * HALTED não é falha, é o orçamento de tempo acabando com dado já gravado.
   */
  const ultimaLeitura = await prisma.syncRun.findFirst({
    where: {
      mode: { in: ["dimensions", "backfill", "incremental", "revisita"] },
      status: { in: ["SUCCESS", "HALTED"] },
      finishedAt: { not: null },
    },
    orderBy: { finishedAt: "desc" },
    select: { finishedAt: true },
  });
  const horasDesdeSync = ultimaLeitura?.finishedAt
    ? (Date.now() - ultimaLeitura.finishedAt.getTime()) / 3_600_000
    : null;

  return (
    <>
      <Cabecalho
        titulo="Motor"
        sub="Estado da integração com o Conexa. Somente leitura — este sistema nunca escreve no ERP."
      />

      <div className="space-y-9">
        {!conexaConfigurado() ? (
          <Faixa tom="critico">
            <strong>Sem token do Conexa.</strong> Configure{" "}
            <code className="rounded-sm bg-[var(--superficie-sutil)] px-1 py-px">
              CONEXA_API_TOKEN
            </code>{" "}
            nas variáveis de ambiente do serviço. Nada sincroniza até lá.
          </Faixa>
        ) : null}

        {horasDesdeSync !== null && horasDesdeSync > 2 ? (
          <Faixa tom="atencao">
            Última <strong>leitura do Conexa</strong> há <strong>{horasDesdeSync.toFixed(1)}h</strong>.
            Acima de 2h, os números da tela podem estar velhos. (A consolidação da inteligência
            roda a cada 30 min sobre o espelho local e <strong>não</strong> conta aqui — ela não
            fala com o ERP.)
          </Faixa>
        ) : null}

        {/* ⚠ Ausência de leitura é pior que leitura velha, e antes não aparecia
            em lugar nenhum: sem nenhum run de leitura, `horasDesdeSync` é null e
            a faixa acima some — a tela ficava silenciosa exatamente no estado em
            que o espelho não está sendo alimentado. */}
        {conexaConfigurado() && horasDesdeSync === null ? (
          <Faixa tom="critico">
            <strong>Nenhuma leitura do Conexa registrada.</strong> O espelho não está sendo
            alimentado — nem carga histórica, nem incremental, nem revarredura. Confira o
            agendador na seção de configuração abaixo.
          </Faixa>
        ) : null}

        {produtos.semCadastro > 0 ? (
          <Faixa tom="atencao">
            <strong>
              {produtos.semCadastro} produto(s) aparecem em vendas mas não estão no catálogo
            </strong>{" "}
            — e passam por eles{" "}
            <strong>
              {produtos.vendasOrfas.toLocaleString("pt-BR")} vendas ({produtos.pctVendasOrfas}% do
              total)
            </strong>
            . A API do Conexa não devolve salas e espaços em{" "}
            <code className="rounded-sm bg-[var(--superficie-sutil)] px-1 py-px">/products</code> —
            ela responde 404 por permissão. Toda regra que depende de{" "}
            <code className="rounded-sm bg-[var(--superficie-sutil)] px-1 py-px">productId</code>{" "}
            falha em silêncio nesses. Solução definitiva: o admin do Conexa liberar o token para
            salas e espaços.
          </Faixa>
        ) : null}

        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Contador rotulo="Clientes" n={clientes} />
          <Contador rotulo="Contratos" n={contratos} />
          <Contador rotulo="Cobranças" n={cobrancas} />
          <Contador rotulo="Vendas" n={vendas} />
          <Contador rotulo="Planos" n={planos} />
          <Contador rotulo="Produtos" n={produtos.noCatalogo} />
        </section>

        <Secao
          titulo="Progresso da carga"
          sub="Por janela mensal, do mês corrente para trás."
          acao={
            <Pulso
              ultimaEscritaISO={pulso.ultimaEscrita?.toISOString() ?? null}
              janelaEmAndamento={pulso.janelaEmAndamento}
              pendentes={pulso.pendentes}
              fundos={pulso.fundos}
            />
          }
        >
          <Painel
            rodape={
              <>
                Completude é <strong>todas as janelas concluídas até o fundo do histórico</strong>.
                A carga anda do mês corrente para trás e só declara o fundo depois de seis janelas
                vazias seguidas — porque a API <strong>não devolve os registros em ordem</strong>,
                então não dá para perguntar &quot;qual é o mais antigo&quot;. Enquanto o fundo não é
                alcançado, o total aparece como <strong>?</strong>: desconhecido nunca é completo.{" "}
                <strong>Lidos da API</strong> é maior que <strong>linhas no espelho</strong> por
                projeto: a paginação instável do Conexa devolve o mesmo registro em páginas
                diferentes, e o upsert colapsa. A coluna da direita é a que bate com os cartões do
                topo.
              </>
            }
          >
            <Rolante>
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Entidade</th>
                    <th className="w-[38%]">Progresso</th>
                    <th className="text-right">Janelas</th>
                    <th className="text-right">Lidos da API</th>
                    <th className="text-right">Linhas no espelho</th>
                  </tr>
                </thead>
                <tbody>
                  {progresso.map((p) => {
                    const completa = p.total !== null && p.concluidas >= p.total;
                    const largura = p.total ? Math.round((p.concluidas / p.total) * 100) : 8;
                    return (
                      <tr key={p.entidade}>
                        <td className="font-medium">{p.entidade}</td>
                        <td>
                          <div className="flex items-center gap-2.5">
                            <span className="barra block max-w-[220px] flex-1">
                              <span
                                className={cn(completa && "!bg-[var(--bom)]")}
                                style={{ width: `${largura}%` }}
                              />
                            </span>
                            {completa ? (
                              <span className="selo selo-bom">completa</span>
                            ) : (
                              <span className="num text-[12.5px] text-[var(--tinta-3)]">
                                {p.total ? `${largura}%` : "—"}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="num text-right">
                          {p.total === null ? (
                            <span
                              className="text-[var(--atencao-tinta)]"
                              title="O fundo do histórico ainda não foi alcançado — não se sabe quantas janelas existem"
                            >
                              {p.concluidas}/?
                            </span>
                          ) : (
                            `${p.concluidas}/${p.total}`
                          )}
                        </td>
                        <td
                          className="num text-right text-[var(--tinta-3)]"
                          title="Registros lidos da API, somando as páginas de todas as janelas"
                        >
                          {p.registros.toLocaleString("pt-BR")}
                        </td>
                        <td className="num text-right font-medium">
                          {p.linhas.toLocaleString("pt-BR")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Rolante>
          </Painel>
        </Secao>

        {admin ? (
          <PainelOperacao />
        ) : (
          <Nota>Ações de sincronização são restritas a administradores.</Nota>
        )}

        <Secao titulo="Execuções recentes">
          {runs.length === 0 ? (
            <Vazio>Nenhuma execução ainda.</Vazio>
          ) : (
            <Painel
              rodape={
                <>
                  <strong>HALTED</strong> não é falha: é o orçamento de tempo da execução acabando
                  — o caso normal do agendador, que trabalha 8,5 min a cada 10. O progresso fica
                  gravado por janela e a próxima execução continua exatamente dali.
                  <br />
                  Os modos: <strong>dimensions</strong> (cadastros), <strong>backfill</strong>{" "}
                  (carga histórica), <strong>incremental</strong> (releitura das janelas recentes,
                  a cada 30 min), <strong>revisita</strong> (revarredura profunda diária, atrás de
                  registro antigo que MUDOU), <strong>reconcile</strong> (conferência sob demanda)
                  e <strong>intelligence</strong> — este último{" "}
                  <strong>não fala com o Conexa</strong>, só recalcula sobre o espelho local, e por
                  isso não conta como sincronização.
                </>
              }
            >
              <Rolante>
                <table className="tabela">
                  <thead>
                    <tr>
                      <th>Quando</th>
                      <th>Modo</th>
                      <th>Status</th>
                      <th className="text-right">Lidos</th>
                      <th className="text-right">Gravados</th>
                      <th className="text-right">Req.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((r) => (
                      <tr key={r.id}>
                        <td className="num whitespace-nowrap text-[var(--tinta-2)]">
                          {dataHoraLocal(r.startedAt)}
                        </td>
                        <td className="text-[var(--tinta-2)]">{r.mode}</td>
                        <td>
                          <Estado status={r.status} />
                          {r.error ? (
                            <div className="mt-1 max-w-md text-[12.5px] leading-relaxed text-[var(--critico-tinta)]">
                              {r.error}
                            </div>
                          ) : null}
                        </td>
                        <td className="num text-right">{r.recordsRead}</td>
                        <td className="num text-right">{r.recordsWrote}</td>
                        <td className="num text-right text-[var(--tinta-3)]">{r.requestsMade}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Rolante>
            </Painel>
          )}
        </Secao>

        <Secao titulo="Configuração">
          <Painel
            rodape={
              <>
                Teto da API: <strong>60 requisições por janela de 60s</strong>, confirmado por
                stress sustentado em 2026-08-27 — 220 requisições seguidas, corte na #58. O consumo
                de terceiros é <strong>zero</strong>: o financeiro em produção usa login web, não a
                API v2. ⚠ A API <strong>não</strong> devolve cabeçalho de saldo em resposta normal,
                então o ritmo é controlado pelo limitador local, nunca por leitura de header. O
                ritmo configurado é um teto, não um alvo, e a folga existe para a rajada futura dos
                agentes do Chatwoot.
              </>
            }
          >
            <dl className="grid gap-x-8 gap-y-4 px-4 py-4 sm:grid-cols-3">
              <Item termo="Ritmo do Conexa" valor={`${env.CONEXA_RATE_LIMIT_PER_MIN} req/min`} />
              <Item termo="Fuso" valor={env.APP_TIMEZONE} />
              <Item termo="Agendador de leitura" valor={env.SYNC_SCHEDULER} />
              <Item termo="Agendador de inteligência" valor={env.INTEL_SCHEDULER} />
              {/* ⚠ Rotulado como "planejado": a camada de disparo NÃO existe —
                  `src/lib/disparo/` não está no repositório, e estas duas
                  variáveis não são lidas por nenhum código que dispare coisa
                  alguma. Exibi-las como configuração ativa faz a tela prometer
                  um comportamento que não acontece. */}
              <Item termo="Disparo (planejado)" valor={env.NOTIFICADOR} />
              <Item termo="Modo de disparo (planejado)" valor={env.NOTIFICADOR_MODO} />
            </dl>
          </Painel>
        </Secao>
      </div>
    </>
  );
}

function Contador({ rotulo, n }: { rotulo: string; n: number }) {
  return (
    <div className="cartao px-3.5 py-3">
      <div className="text-[13px] text-[var(--tinta-2)]">{rotulo}</div>
      <div
        className={cn(
          "num mt-1.5 text-[21px] font-semibold leading-none tracking-[-0.02em]",
          n === 0 && "text-[var(--tinta-3)]",
        )}
      >
        {n.toLocaleString("pt-BR")}
      </div>
    </div>
  );
}

function Item({ termo, valor }: { termo: string; valor: string }) {
  return (
    <div>
      <dt className="text-[12px] uppercase tracking-[0.04em] text-[var(--tinta-3)]">{termo}</dt>
      <dd className="mt-0.5 text-[14.5px] font-medium">{valor}</dd>
    </div>
  );
}

/**
 * ⚠ Status com selo + texto. A cor sozinha nunca diz se a carga falhou — é a
 * informação que, perdida, deixa uma integração morta parecer viva.
 */
function Estado({ status }: { status: string }) {
  const classe =
    status === "SUCCESS"
      ? "selo-bom"
      : status === "FAILED"
        ? "selo-critico"
        : status === "HALTED"
          ? "selo-info"
          : status === "RUNNING"
            ? "selo-atencao"
            : "";
  return <span className={cn("selo", classe)}>{status}</span>;
}
