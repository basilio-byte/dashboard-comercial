import { CircleCheck, CircleDashed, Clock, Ban, type LucideIcon } from "lucide-react";
import { estadoDoEspelho } from "@/lib/intel/completude";
import { Cabecalho, Faixa, Secao } from "@/components/Cartao";
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
 * "Gatilho" é a palavra do documento de especificação do cliente. Usar o
 * vocabulário dele, e não o de um dashboard financeiro, é parte de o sistema
 * ser deste negócio.
 */

type Estado = "ligado" | "aguardando" | "bloqueado" | "pendente";

interface Gatilho {
  n: number | null;
  nome: string;
  condicao: string;
  oferta: string;
  estado: Estado;
  nota: string;
}

function gatilhos(horasConfiavel: boolean): Gatilho[] {
  return [
    {
      n: null,
      nome: "Estoura a cota de horas",
      condicao: "usa mais horas do que o plano oferece, em ciclos seguidos",
      oferta: "upgrade de plano",
      estado: horasConfiavel ? "ligado" : "aguardando",
      nota: horasConfiavel
        ? "ativo — único gatilho rodando hoje"
        : "aguardando a carga de reservas e contratos terminar",
    },
    {
      n: 1,
      nome: "Fiscal completa 11 meses",
      condicao: "contrato de Endereço Fiscal chega a 11 meses",
      oferta: "plano Bianual",
      estado: "pendente",
      nota: "motor de regras não implementado · falta definir se o relógio começa em startDate ou fidelityDate",
    },
    {
      n: 2,
      nome: "Pacote de horas acabando",
      condicao: "saldo do pacote abaixo do limiar",
      oferta: "novo pacote",
      estado: "bloqueado",
      nota: "depende da validação do saldo contra a tela do Conexa — ver Confiança",
    },
    {
      n: 3,
      nome: "Padrão de compra irregular",
      condicao: "compra caindo mês a mês",
      oferta: "novo pacote",
      estado: "bloqueado",
      nota: '"irregular" ainda não tem definição numérica — quantos meses, qual queda?',
    },
    {
      n: 4,
      nome: "Avulso com uso alto",
      condicao: "só compra hora avulsa, mas passou de 5h no mês",
      oferta: "pacote de horas, mostrando a economia",
      estado: "pendente",
      nota: "o gatilho é sólido; a economia depende de uma tabela de preços que é cadastro manual",
    },
    {
      n: 5,
      nome: "Primeira reserva de sala",
      condicao: "primeira reserva do cliente, na data",
      oferta: "Endereço Fiscal + SeaBox",
      estado: "pendente",
      nota: "exige a carga completa de reservas — sem ela, todo cliente antigo parece estreante",
    },
    {
      n: 6,
      nome: "Privativa completa 1 mês",
      condicao: "1 mês do início do contrato de sala privativa",
      oferta: "Registro de Marca",
      estado: "pendente",
      nota: "motor de regras não implementado",
    },
    {
      n: 7,
      nome: "Privativa completa 2 meses",
      condicao: "2 meses do início do contrato",
      oferta: "SeaBox como benefício",
      estado: "pendente",
      nota: "se o SeaBox é cortesia e não vira venda, o sistema nunca saberá que o cliente já recebeu",
    },
    {
      n: 8,
      nome: "Privativa até 6 meses",
      condicao: "até o 6º mês do contrato",
      oferta: "Panteão",
      estado: "pendente",
      nota: 'produto existe (3380/3381) · falta definir se "até o 6º mês" é aniversário ou janela aberta',
    },
    {
      n: 9,
      nome: "Pacote abaixo de 5h",
      condicao: "saldo do pacote menor que 5h",
      oferta: "novo pacote",
      estado: "bloqueado",
      nota: "mesma dependência do gatilho 2 — é o mesmo cálculo com outro limiar",
    },
    {
      n: 10,
      nome: "Litoral reserva sala",
      condicao: "plano de Endereço Fiscal SEM horas inclusas + fez reserva",
      oferta: "Pacote de Horas ou upgrade para Batial (2h/mês)",
      estado: "pendente",
      nota: "desbloqueado: o tier vem da cota do plano, não do nome — Batial 2h confirmado na API",
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
  { classeSelo: string; classeAresta: string; Icone: LucideIcon; rotulo: string }
> = {
  ligado: {
    classeSelo: "selo-bom",
    classeAresta: "bg-[var(--bom)]",
    Icone: CircleCheck,
    rotulo: "ligado",
  },
  aguardando: {
    classeSelo: "selo-atencao",
    classeAresta: "bg-[var(--atencao)]",
    Icone: Clock,
    rotulo: "aguardando dado",
  },
  bloqueado: {
    classeSelo: "selo-critico",
    classeAresta: "bg-[var(--critico)]",
    Icone: Ban,
    rotulo: "bloqueado",
  },
  pendente: {
    classeSelo: "",
    classeAresta: "bg-[var(--linha)]",
    Icone: CircleDashed,
    rotulo: "não implementado",
  },
};

const ORDEM_RESUMO: Estado[] = ["ligado", "aguardando", "bloqueado", "pendente"];

export default async function Gatilhos() {
  const espelho = await estadoDoEspelho();
  const lista = gatilhos(espelho.horasConfiavel);
  const contagem = (e: Estado) => lista.filter((g) => g.estado === e).length;
  const ligados = contagem("ligado");

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
        {/* Placar por estado: responde "quanto do motor está de pé?" antes de
            qualquer leitura item a item. */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {ORDEM_RESUMO.map((e) => {
            const { Icone, rotulo, classeSelo } = ESTILO[e];
            const n = contagem(e);
            return (
              <div key={e} className="cartao px-3.5 py-3">
                <div className="flex items-center gap-1.5 text-[12px] text-[var(--tinta-2)]">
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
              </div>
            );
          })}
        </div>

        <Faixa tom="info">
          Nenhum gatilho cria task no ClickUp ainda — <strong>a camada de disparo não existe</strong>.
          O que roda hoje aparece no Radar, para o vendedor decidir o que fazer.
        </Faixa>

        <Secao
          titulo="Os gatilhos"
          sub="Fonte: documento de especificação do cliente, mais um derivado da conversa com o responsável."
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

                  <div className="mt-2 grid gap-x-8 gap-y-1 text-[13px] sm:grid-cols-2">
                    <div className="text-[var(--tinta-2)]">
                      <span className="text-[var(--tinta-3)]">quando: </span>
                      {g.condicao}
                    </div>
                    <div className="text-[var(--tinta-2)]">
                      <span className="text-[var(--tinta-3)]">oferta: </span>
                      {g.oferta}
                    </div>
                  </div>

                  <p className="mt-2 text-[12px] leading-relaxed text-[var(--tinta-3)]">{g.nota}</p>
                </div>
              );
            })}
          </div>
        </Secao>
      </div>
    </>
  );
}
