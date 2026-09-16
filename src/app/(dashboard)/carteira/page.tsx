import Link from "next/link";
import { UserX } from "lucide-react";
import { formatBRL } from "@/lib/money";
import { rotuloMes } from "@/lib/dates";
import { Procedencia } from "@/components/Procedencia";
import { SerieMensalDaCarteira } from "./serie-mensal";
import { MetricasDaCarteira } from "./metricas";
import { corVariacao, pct } from "@/lib/ui";
import { estadoDoEspelho } from "@/lib/intel/completude";
import { AvisoCompletude, ValorOuLacuna } from "@/components/AvisoCompletude";
import { Cabecalho, Faixa, Nota, Painel, Rolante, Vazio } from "@/components/Cartao";
import { buscarCarteira, opcoesDeFiltro, type FiltroCarteira } from "@/lib/carteira/filtros";
import { FiltrosDaCarteira } from "./filtros";

export const dynamic = "force-dynamic";

/**
 * CARTEIRA — os clientes, e o que já se sabe de cada um.
 *
 * ⚠ **Os filtros são o pedido do Diego em 2026-09-16**, e o exemplo dele era
 * literal: *"filtrar por Plano X + Receita de maior para menor"*. Por isso todo
 * filtro acumula e a ordenação é independente deles — o desenho de "um filtro
 * por vez" responderia à metade da pergunta.
 *
 * ⚠ **"Horas disponíveis" não está entre os filtros, e a tela diz por quê.**
 * O saldo do pacote vive atrás de um 404 de permissão. Um filtro que aceitasse
 * o campo teria de inventar o número ou devolver lista vazia; as duas coisas
 * mentem, e a segunda mente em silêncio. Aparecer como lacuna declarada é o que
 * faz alguém pedir a liberação ao admin do Conexa em vez de esperar para sempre.
 */
export default async function Carteira({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;

  const num = (v: string | undefined) => {
    if (v === undefined || v === "") return undefined;
    const n = Number(v);
    return Number.isNaN(n) ? undefined : n;
  };
  const bool = (v: string | undefined) => (v === "1" ? true : v === "0" ? false : undefined);

  const filtro: FiltroCarteira = {
    busca: sp.q,
    segmentos: sp.segmento ? [sp.segmento] : undefined,
    unidade: sp.unidade || undefined,
    planoConexaId: num(sp.plano),
    categoriaConexaId: num(sp.categoria),
    receitaMin: num(sp.receitaMin),
    receitaMax: num(sp.receitaMax),
    horasMin: num(sp.horasMin),
    horasMax: num(sp.horasMax),
    semCota: bool(sp.semCota),
    comContratoAtivo: bool(sp.contrato),
    estourouCota: bool(sp.estourou),
    semContatoHaDias: num(sp.dias),
    incluirInelegiveis: sp.inelegiveis === "1",
    ordenarPor: (sp.ordem as FiltroCarteira["ordenarPor"]) || "receita",
    direcao: (sp.dir as "asc" | "desc") || undefined,
    limite: 100,
    offset: num(sp.pagina) ? (num(sp.pagina)! - 1) * 100 : 0,
  };

  const [espelho, resultado, opcoes] = await Promise.all([
    estadoDoEspelho(),
    buscarCarteira(filtro),
    opcoesDeFiltro(),
  ]);

  const pagina = num(sp.pagina) ?? 1;
  const paginas = Math.max(1, Math.ceil(resultado.total / 100));

  return (
    <>
      <Cabecalho
        titulo="Carteira"
        sub="Seus clientes, e o que já se sabe sobre cada um. A receita vive aqui dentro, como atributo — não como tela própria."
        acao={
          <span className="selo">
            {resultado.total.toLocaleString("pt-BR")}{" "}
            {resultado.total === 1 ? "cliente" : "clientes"}
          </span>
        }
      />

      <div className="space-y-6">
        <AvisoCompletude estado={espelho} />

        <FiltrosDaCarteira opcoes={opcoes} valores={sp} lacunas={resultado.lacunas} />

        {resultado.avisos.map((a) => (
          <Faixa key={a} tom="atencao">
            {a}
          </Faixa>
        ))}

        {resultado.itens.length === 0 ? (
          <Vazio Icone={UserX}>
            Nenhum cliente com esses filtros.
            {resultado.total === 0 && !sp.q ? (
              <>
                {" "}
                Se a base ainda está vazia, a carga roda sozinha — acompanhe o progresso em Motor.
              </>
            ) : null}
          </Vazio>
        ) : (
          <Painel
            titulo={
              <>
                Mostrando {resultado.itens.length} de {resultado.total.toLocaleString("pt-BR")}
                {paginas > 1 ? (
                  <span className="text-[var(--tinta-3)]">
                    {" "}
                    · página {pagina} de {paginas}
                  </span>
                ) : null}
              </>
            }
            rodape={
              paginas > 1 ? (
                <Paginacao pagina={pagina} paginas={paginas} params={sp} />
              ) : null
            }
          >
            <Rolante>
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Segmento</th>
                    <th className="text-right">Horas/mês</th>
                    <th className="text-right">Receita no ano</th>
                    <th className="text-right">{rotuloMes(resultado.mesDaVariacao)}</th>
                    <th>Último contato</th>
                  </tr>
                </thead>
                <tbody>
                  {resultado.itens.map((c) => {
                    const inelegivel = !c.ativo || c.bloqueado;
                    return (
                      <tr key={c.customerConexaId} className={inelegivel ? "opacity-55" : undefined}>
                        <td>
                          <Link
                            href={`/carteira/${c.customerConexaId}`}
                            className="font-medium hover:text-[var(--acento-tinta)] hover:underline"
                          >
                            {c.nome ?? `Cliente ${c.customerConexaId}`}
                          </Link>
                          {inelegivel ? (
                            <span className="selo ml-2">{c.bloqueado ? "bloqueado" : "inativo"}</span>
                          ) : null}
                          {c.estouraCota ? (
                            <span
                              className="selo selo-critico ml-2"
                              title="paga horas por fora do plano com recorrência"
                            >
                              estoura a cota
                            </span>
                          ) : null}
                        </td>
                        <td className="text-[var(--tinta-2)]">
                          {c.segmentos.length ? c.segmentos.join(", ") : "—"}
                        </td>
                        <td className="num text-right">
                          {c.horasInclusasMes === null ? (
                            c.temContratoAtivo ? (
                              <span
                                className="text-[var(--tinta-3)]"
                                title="Plano sem horas inclusas — é o caso do Endereço Fiscal Litoral"
                              >
                                sem cota
                              </span>
                            ) : (
                              "—"
                            )
                          ) : (
                            `${c.horasInclusasMes}h`
                          )}
                        </td>
                        <td className="num text-right font-medium">
                          <ValorOuLacuna
                            valor={formatBRL(c.receitaAno)}
                            confiavel={espelho.receitaConfiavel}
                          />
                        </td>
                        {/* ⚠ Mesmo portão da coluna de receita ao lado. A
                            variação é derivada da MESMA receita, então liberá-la
                            enquanto a receita diz "não disponível" imprime um
                            "-100,0%" vermelho sobre dado que a própria linha
                            acabou de declarar indisponível — e vermelho é o que
                            o olho lê primeiro. */}
                        <td
                          className={`num text-right ${
                            espelho.receitaConfiavel ? corVariacao(c.variacaoUltimoMes) : ""
                          }`}
                        >
                          {espelho.receitaConfiavel ? pct(c.variacaoUltimoMes) : "—"}
                        </td>
                        <td className="whitespace-nowrap text-[13px] text-[var(--tinta-2)]">
                          {c.ultimoContatoEm ? (
                            <span className="selo" title={c.ultimoContatoQuem ?? undefined}>
                              {new Date(c.ultimoContatoEm).toLocaleDateString("pt-BR")}
                            </span>
                          ) : (
                            <span className="text-[var(--tinta-3)]">nunca</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Rolante>
          </Painel>
        )}

        <Nota>
          {/* ⚠ O selo segue o portão. Cravado como DERIVADO, ele certificava a
              procedência de uma coluna que, ao lado, dizia "não disponível". */}
          <Procedencia tipo={espelho.receitaConfiavel ? "DERIVADO" : "INDISPONIVEL"} /> receita no
          regime de emissão · <Procedencia tipo="API" /> horas inclusas vêm de{" "}
          <code className="rounded-sm bg-[var(--superficie-sutil)] px-1 py-px">plan.hourQuotas</code>
          . &quot;Sem cota&quot; significa plano sem horas inclusas, e não zero hora ·{" "}
          <Procedencia tipo="MANUAL" /> o último contato é digitado pelo vendedor.
        </Nota>

        <hr className="divisor !mt-10" />

        {/* Métricas exigidas pela especificação do Diego, movidas do Radar:
            receita é atributo do cliente, não resposta a "quem procurar hoje". */}
        <MetricasDaCarteira confiavel={espelho.receitaConfiavel} barram={espelho.barramReceita} />

        <hr className="divisor !mt-10" />

        <SerieMensalDaCarteira />
      </div>
    </>
  );
}

function Paginacao({
  pagina,
  paginas,
  params,
}: {
  pagina: number;
  paginas: number;
  params: Record<string, string | undefined>;
}) {
  const url = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== "pagina") q.set(k, v);
    if (p > 1) q.set("pagina", String(p));
    const s = q.toString();
    return s ? `/carteira?${s}` : "/carteira";
  };
  return (
    <div className="flex items-center justify-between gap-3">
      <span>
        Página {pagina} de {paginas}
      </span>
      <span className="flex gap-2">
        {pagina > 1 ? (
          <Link href={url(pagina - 1)} className="btn btn-fantasma py-1">
            Anterior
          </Link>
        ) : null}
        {pagina < paginas ? (
          <Link href={url(pagina + 1)} className="btn btn-fantasma py-1">
            Próxima
          </Link>
        ) : null}
      </span>
    </div>
  );
}
