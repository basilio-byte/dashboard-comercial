import { CircleCheck, Clock, Ban, HelpCircle, Hammer, type LucideIcon } from "lucide-react";
import { estadoDoEspelho } from "@/lib/intel/completude";
import { Cabecalho, Faixa, Nota, Secao } from "@/components/Cartao";
import { cn } from "@/lib/ui";

export const dynamic = "force-dynamic";

/**
 * GATILHOS — o que dispara oferta, e o que ainda não dispara.
 *
 * Esta tela existe por um motivo específico: **fila vazia precisa ser
 * interpretável**. Sem ela, "ninguém tem oportunidade hoje" e "o motor está
 * desligado" têm a mesma aparência — e a segunda situação, silenciosa, é como
 * uma automação morre sem ninguém perceber.
 *
 * ⚠ Os estados separam DE QUEM é a próxima ação. A versão anterior jogava tudo
 * em "não implementado", o que escondia a diferença que importa: metade espera
 * uma decisão do cliente e a outra metade espera só código. Com a carga
 * completa em 2026-08-27, cinco gatilhos passaram de "falta dado" para "falta
 * implementar" — e isso ficava invisível numa tela com dois baldes.
 *
 * "Gatilho" é a palavra do documento de especificação do cliente.
 */

type Estado = "ligado" | "aguardando" | "pronto" | "definicao" | "validacao";

interface Gatilho {
  n: number | null;
  nome: string;
  condicao: string;
  oferta: string;
  estado: Estado;
  nota: string;
}

function gatilhos(horasConfiavel: boolean, reservasOk: boolean, contratosOk: boolean): Gatilho[] {
  return [
    {
      n: null,
      nome: "Estoura a cota de horas",
      condicao: "usa mais horas do que o plano oferece, em ciclos seguidos",
      oferta: "upgrade de plano",
      estado: horasConfiavel ? "ligado" : "aguardando",
      nota: horasConfiavel
        ? "ativo — roda sobre a base elegível inteira, sem corte"
        : "aguardando a carga de reservas e contratos terminar",
    },
    {
      n: 4,
      nome: "Avulso com uso alto",
      condicao: "só compra hora avulsa, mas passou de 5h no mês",
      oferta: "pacote de horas",
      estado: reservasOk ? "pronto" : "aguardando",
      nota: "o dado necessário está carregado · a economia vs. avulso exige uma tabela de preços que é cadastro manual — dá para disparar sem ela, só sem o número da economia",
    },
    {
      n: 5,
      nome: "Primeira reserva de sala",
      condicao: "primeira reserva do cliente, na data",
      oferta: "Endereço Fiscal + SeaBox",
      estado: reservasOk ? "pronto" : "aguardando",
      nota: "desbloqueado pela carga completa de reservas — antes, sem o histórico inteiro, todo cliente antigo parecia estreante",
    },
    {
      n: 6,
      nome: "Privativa completa 1 mês",
      condicao: "1 mês do início do contrato de sala privativa",
      oferta: "Registro de Marca",
      estado: contratosOk ? "pronto" : "aguardando",
      nota: "marco de data puro sobre contrato — `contratoDesde` já está consolidado no perfil",
    },
    {
      n: 7,
      nome: "Privativa completa 2 meses",
      condicao: "2 meses do início do contrato",
      oferta: "SeaBox como benefício",
      estado: contratosOk ? "pronto" : "aguardando",
      nota: "dispara, mas SEM supressão: se o SeaBox é cortesia e não vira venda, o sistema não sabe que o cliente já recebeu e vai reofertar",
    },
    {
      n: 10,
      nome: "Litoral reserva sala",
      condicao: "plano de Endereço Fiscal SEM horas inclusas + fez reserva",
      oferta: "Pacote de Horas ou upgrade para Batial (2h/mês)",
      estado: reservasOk && contratosOk ? "pronto" : "aguardando",
      nota: "o tier vem da cota do plano, não do nome do produto — Batial 2h confirmado na API",
    },
    {
      n: 1,
      nome: "Fiscal completa 11 meses",
      condicao: "contrato de Endereço Fiscal chega a 11 meses",
      oferta: "plano Bianual",
      estado: "definicao",
      nota: "o relógio começa em `startDate` ou `fidelityDate`? A diferença muda quem entra na fila",
    },
    {
      n: 3,
      nome: "Padrão de compra irregular",
      condicao: "compra caindo mês a mês",
      oferta: "novo pacote",
      estado: "definicao",
      nota: '"irregular" não tem definição numérica — quantos meses seguidos, e qual queda conta?',
    },
    {
      n: 8,
      nome: "Privativa até 6 meses",
      condicao: "até o 6º mês do contrato",
      oferta: "Panteão",
      estado: "definicao",
      nota: 'produto existe (3380/3381) · "até o 6º mês" é aniversário ou janela aberta?',
    },
    {
      n: 2,
      nome: "Pacote de horas acabando",
      condicao: "saldo do pacote abaixo do limiar",
      oferta: "novo pacote",
      estado: "validacao",
      nota: "o saldo é derivado, não lido da API — precisa bater contra a tela do Conexa antes de virar oferta. Ver Confiança",
    },
    {
      n: 9,
      nome: "Pacote abaixo de 5h",
      condicao: "saldo do pacote menor que 5h",
      oferta: "novo pacote",
      estado: "validacao",
      nota: "mesma dependência do gatilho 2 — é o mesmo cálculo com outro limiar",
    },
  ];
}

/**
 * ⚠ Cada estado tem ÍCONE, RÓTULO e cor — nesta ordem de importância. A cor
 * sozinha não pode carregar "este gatilho está desligado": é exatamente a
 * informação que, perdida, faz alguém achar que o motor está rodando.
 */
const ESTILO: Record<
  Estado,
  { classeSelo: string; classeAresta: string; Icone: LucideIcon; rotulo: string; deQuem: string }
> = {
  ligado: {
    classeSelo: "selo-bom",
    classeAresta: "bg-[var(--bom)]",
    Icone: CircleCheck,
    rotulo: "ligado",
    deQuem: "rodando",
  },
  aguardando: {
    classeSelo: "selo-atencao",
    classeAresta: "bg-[var(--atencao)]",
    Icone: Clock,
    rotulo: "aguardando dado",
    deQuem: "espera a carga",
  },
  pronto: {
    classeSelo: "selo-info",
    classeAresta: "bg-[var(--acento)]",
    Icone: Hammer,
    rotulo: "pronto para implementar",
    deQuem: "espera código",
  },
  definicao: {
    classeSelo: "",
    classeAresta: "bg-[var(--tinta-3)]",
    Icone: HelpCircle,
    rotulo: "falta definição",
    deQuem: "espera o cliente",
  },
  validacao: {
    classeSelo: "selo-critico",
    classeAresta: "bg-[var(--critico)]",
    Icone: Ban,
    rotulo: "falta validar o saldo",
    deQuem: "espera conferência",
  },
};

const ORDEM_RESUMO: Estado[] = ["ligado", "pronto", "definicao", "validacao"];

export default async function Gatilhos() {
  const espelho = await estadoDoEspelho();
  const completa = (e: string) =>
    espelho.entidades.find((x) => x.entidade === e)?.completa ?? false;

  const lista = gatilhos(espelho.horasConfiavel, completa("bookings"), completa("contracts"));
  const contagem = (e: Estado) => lista.filter((g) => g.estado === e).length;
  const ligados = contagem("ligado");
  const prontos = contagem("pronto");

  return (
    <>
      <Cabecalho
        titulo="Gatilhos"
        sub={
          <>
            O que dispara uma oferta — e, principalmente, o que ainda <strong>não</strong> dispara.
            Uma fila vazia só quer dizer alguma coisa quando se sabe o que está ligado.
          </>
        }
        acao={
          <span className={cn("selo", ligados > 0 ? "selo-bom" : "selo-atencao")}>
            {ligados} de {lista.length} ativos
          </span>
        }
      />

      <div className="space-y-8">
        {/* Placar por estado. O que interessa não é "quantos faltam", é DE QUEM
            é a próxima ação em cada um. */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {ORDEM_RESUMO.map((e) => {
            const { Icone, rotulo, classeSelo, deQuem } = ESTILO[e];
            const n = contagem(e);
            return (
              <div key={e} className="cartao px-3.5 py-3">
                <div className="flex items-center gap-1.5 text-[13px] text-[var(--tinta-2)]">
                  <span className={cn("selo h-5 w-5 justify-center p-0", classeSelo)}>
                    <Icone size={12} />
                  </span>
                  {rotulo}
                </div>
                <div
                  className={cn(
                    "num mt-1.5 text-[22px] font-semibold leading-none",
                    n === 0 && "text-[var(--tinta-3)]",
                  )}
                >
                  {n}
                </div>
                <div className="mt-1 text-[12px] text-[var(--tinta-3)]">{deQuem}</div>
              </div>
            );
          })}
        </div>

        {prontos > 0 ? (
          <Faixa tom="info">
            <strong>
              {prontos} {prontos === 1 ? "gatilho tem" : "gatilhos têm"} todo o dado necessário
            </strong>{" "}
            e espera apenas o motor de regras — que ainda não existe. Nenhum cria task no ClickUp:
            a camada de disparo não foi construída. O que roda hoje aparece no Radar, para o
            vendedor decidir o que fazer.
          </Faixa>
        ) : null}

        <Secao
          titulo="Os gatilhos"
          sub="Agrupados pelo que falta. Fonte: documento de especificação do cliente, mais um derivado da conversa com o responsável."
        >
          <div className="space-y-2">
            {lista.map((g) => {
              const e = ESTILO[g.estado];
              return (
                <div
                  key={g.nome}
                  className="cartao cartao-alvo relative overflow-hidden px-4 py-3.5 pl-5"
                >
                  {/* Aresta de estado: legível de relance na lista inteira. */}
                  <span
                    aria-hidden
                    className={cn("absolute inset-y-0 left-0 w-[3px]", e.classeAresta)}
                  />

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <span className="text-[14.5px] font-semibold">{g.nome}</span>
                    <span className="selo">
                      {g.n ? `regra ${g.n}` : "pedido do responsável"}
                    </span>
                    <span className={cn("selo ml-auto", e.classeSelo)}>
                      <e.Icone size={11.5} aria-hidden />
                      {e.rotulo}
                    </span>
                  </div>

                  <div className="mt-2 grid gap-x-8 gap-y-1 text-[14px] sm:grid-cols-2">
                    <div className="text-[var(--tinta-2)]">
                      <span className="text-[var(--tinta-3)]">quando: </span>
                      {g.condicao}
                    </div>
                    <div className="text-[var(--tinta-2)]">
                      <span className="text-[var(--tinta-3)]">oferta: </span>
                      {g.oferta}
                    </div>
                  </div>

                  <p className="mt-2 text-[13px] leading-relaxed text-[var(--tinta-3)]">{g.nota}</p>
                </div>
              );
            })}
          </div>
        </Secao>

        <Nota>
          As três perguntas em <strong>falta definição</strong> estão em
          <code className="mx-1 rounded-sm bg-[var(--superficie-sutil)] px-1 py-px">
            docs/context/perguntas-abertas.md
          </code>
          e precisam de resposta do cliente — não há como decidi-las pelo dado. As duas em{" "}
          <strong>falta validar</strong> dependem de alguém conferir ~20 linhas na tela Confiança
          contra o Conexa.
        </Nota>
      </div>
    </>
  );
}
