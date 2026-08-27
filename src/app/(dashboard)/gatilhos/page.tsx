import { CircleCheck, TriangleAlert, Ban, CircleDashed, type LucideIcon } from "lucide-react";
import { estadoDoEspelho } from "@/lib/intel/completude";
import { Cabecalho, Faixa, Nota, Secao } from "@/components/Cartao";
import { cn } from "@/lib/ui";

export const dynamic = "force-dynamic";

/**
 * GATILHOS — o que dispara oferta, e o que ainda não dispara.
 *
 * Esta tela existe porque **fila vazia precisa ser interpretável**: sem ela,
 * "ninguém tem oportunidade hoje" e "o motor está desligado" têm a mesma
 * aparência, e a segunda é como uma automação morre sem ninguém perceber.
 *
 * ⚠ Os estados são os de `docs/context/regras-comerciais.md`, que é a análise
 * de viabilidade do documento do Diego cruzada com o que a Fase 0 mediu contra
 * a API. Eu cheguei a inventar aqui uma taxonomia paralela ("pronto para
 * implementar") e ela estava ERRADA em três regras — dizia pronto o que o
 * repositório já tinha analisado como tendo ressalva concreta. Uma tela que
 * discorda da análise do próprio projeto é pior que uma tela sem estado.
 */

type Estado = "ligado" | "viavel" | "ressalva" | "definicao";

interface Gatilho {
  n: string;
  nome: string;
  condicao: string;
  oferta: string;
  familia: string;
  estado: Estado;
  nota: string;
}

function gatilhos(horasConfiavel: boolean, reservasOk: boolean): Gatilho[] {
  return [
    {
      n: "extra",
      nome: "Estoura a cota de horas",
      condicao: "usa mais horas do que o plano oferece, em ciclos seguidos",
      oferta: "upgrade de plano",
      familia: "EXCEDENTE",
      estado: horasConfiavel ? "ligado" : "ressalva",
      nota: horasConfiavel
        ? "rodando sobre a base elegível inteira, sem corte · não está no documento do Diego: é pedido do responsável, e foi marcado como o mais importante"
        : "aguardando o selo de completude de contratos e reservas",
    },
    {
      n: "4",
      nome: "Avulso com uso alto",
      condicao: "nenhum contrato com cota, mas passou de 5h no mês",
      oferta: "pacote de horas",
      familia: "USO_SEM_COTA",
      estado: "viavel",
      nota: "função pura escrita e testada · a economia vs. avulso NÃO sai: o próprio documento (§3.1) registra que a API não expõe preço por hora por produto. A task sai com a lacuna declarada, nunca com número estimado",
    },
    {
      n: "10",
      nome: "Litoral reserva sala",
      condicao: "plano de Endereço Fiscal sem horas inclusas + fez reserva",
      oferta: "Pacote de Horas ou upgrade para Batial (2h/mês)",
      familia: "EVENTO_EM_SEGMENTO",
      estado: "viavel",
      nota: "função pura escrita e testada · o tier vem da cota do plano, não do nome — Litoral sem cota, Batial 2h, Abissal 8h, medido na Fase 0",
    },
    {
      n: "1",
      nome: "Fiscal completa 11 meses",
      condicao: "contrato de Endereço Fiscal chega a 11 meses de startDate",
      oferta: "plano Bianual",
      familia: "MARCO_CONTRATO",
      estado: "ressalva",
      nota: "âncora decidida em 2026-08-27: startDate · ⚠ restam duas ressalvas do catálogo: só existem 2 produtos Bianual, ambos SEATECH — pode não haver oferta para o tier do cliente; e a API não encadeia contratos, então quem renovou conta do atual",
    },
    {
      n: "3",
      nome: "Padrão de compra irregular",
      condicao: "queda em meses consecutivos",
      oferta: "novo pacote",
      familia: "TENDENCIA",
      estado: "ressalva",
      nota: 'definido em 2026-08-27: "mês a mês" · implementado com 2 quedas seguidas, que é o exemplo do documento (20h, 10h, nada) · ⚠ falta confirmar se "comprou 20h" é COMPRA ou CONSUMO — vêm de endpoints diferentes',
    },
    {
      n: "5",
      nome: "Primeira reserva de sala",
      condicao: "primeira reserva do cliente, na data",
      oferta: "Endereço Fiscal + SeaBox",
      familia: "PRIMEIRO_EVENTO",
      estado: reservasOk ? "viavel" : "ressalva",
      nota: reservasOk
        ? "destravada pela carga completa de reservas (37/37) · a data de corte é parâmetro obrigatório: sem ela, todo cliente antigo parece estreante e saem milhares de tasks de uma vez"
        : "sem o histórico completo de reservas, todo cliente antigo parece estreante",
    },
    {
      n: "6",
      nome: "Privativa completa 1 mês",
      condicao: "1 mês do início do contrato de sala privativa",
      oferta: "Registro de Marca",
      familia: "MARCO_CONTRATO",
      estado: "viavel",
      nota: 'decidido em 2026-08-27: identifica pela CATEGORIA do plano, e a estação de coworking CONTA — a categoria "Salas Privativas - Seaway Center" vale inteira · âncora startDate, por coerência com a regra 1',
    },
    {
      n: "7",
      nome: "Privativa completa 2 meses",
      condicao: "2 meses do início do contrato",
      oferta: "SeaBox como benefício",
      familia: "MARCO_CONTRATO",
      estado: "ressalva",
      nota: "identificação resolvida junto com a regra 6 · ⚠ resta o SeaBox: é cortesia, e se não vira venda no Conexa o sistema nunca saberá que o cliente já recebeu — vai reofertar. Ou passa a ser registrado, ou a regra vira disparo único por cliente",
    },
    {
      n: "8",
      nome: "Privativa completa 6 meses",
      condicao: "aniversário de 6 meses do contrato",
      oferta: "Panteão",
      familia: "MARCO_CONTRATO",
      estado: "viavel",
      nota: "decidido em 2026-08-27: ANIVERSÁRIO, não janela aberta — a diferença é entre uma oferta e cento e oitenta · identificação pela categoria, com a estação contando · produto confirmado na Fase 0 (3380/3381)",
    },
    {
      n: "2",
      nome: "Pacote de horas acabando",
      condicao: "saldo do pacote abaixo do limiar",
      oferta: "novo pacote",
      familia: "SALDO_COTA",
      estado: "definicao",
      nota: "o saldo é DERIVADO, não lido: o documento (§3.1) registra que a API não expõe saldo de pacote. Precisa bater contra a tela do Conexa antes de virar oferta — ~20 linhas na tela Confiança",
    },
    {
      n: "9",
      nome: "Pacote abaixo de 5h",
      condicao: "saldo do pacote menor que 5h",
      oferta: "novo pacote",
      familia: "SALDO_COTA",
      estado: "definicao",
      nota: "mesma mecânica da regra 2, outro limiar — as duas passam ou reprovam juntas na conferência",
    },
    {
      n: "métrica",
      nome: "Queda de receita",
      condicao: "receita cai X% de um mês fechado para o outro",
      oferta: "olhar o cliente antes que ele saia",
      familia: "TENDENCIA",
      estado: "ressalva",
      nota: "é a métrica de alerta do documento (§1), já visível na Carteira · função pura escrita e testada · ⚠ falta o cliente definir o X — hoje a tela usa 30% como exemplo, não como decisão",
    },
  ];
}

/**
 * ⚠ Cada estado tem ÍCONE, RÓTULO e cor. A cor sozinha não pode carregar "este
 * gatilho está desligado": é exatamente a informação que, perdida, faz alguém
 * achar que o motor está rodando.
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
    deQuem: "disparando no Radar",
  },
  viavel: {
    classeSelo: "selo-info",
    classeAresta: "bg-[var(--acento)]",
    Icone: CircleDashed,
    rotulo: "viável",
    deQuem: "dado e regra prontos",
  },
  ressalva: {
    classeSelo: "selo-atencao",
    classeAresta: "bg-[var(--atencao)]",
    Icone: TriangleAlert,
    rotulo: "com ressalva",
    deQuem: "falta uma decisão",
  },
  definicao: {
    classeSelo: "selo-critico",
    classeAresta: "bg-[var(--critico)]",
    Icone: Ban,
    rotulo: "aguarda conferência",
    deQuem: "falta validar o saldo",
  },
};

const ORDEM_RESUMO: Estado[] = ["ligado", "viavel", "ressalva", "definicao"];

export default async function Gatilhos() {
  const espelho = await estadoDoEspelho();
  const reservasOk = espelho.entidades.find((e) => e.entidade === "bookings")?.completa ?? false;
  const lista = gatilhos(espelho.horasConfiavel, reservasOk);
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
            {ligados} de {lista.length} disparando
          </span>
        }
      />

      <div className="space-y-8">
        {/* O placar não conta "quantos faltam" — conta DE QUEM é a próxima ação. */}
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

        <Faixa tom="info">
          <strong>As regras já existem como funções puras testadas</strong> —{" "}
          <code className="rounded-sm bg-[var(--superficie-sutil)] px-1 py-px">
            src/lib/regras/familias.ts
          </code>
          , 26 testes. O que falta para virarem oferta de verdade é a{" "}
          <strong>camada de disparo</strong>: criar task no ClickUp para o vendedor responsável.
          Ela não existe, e depende de o ClickUp entrar — é de lá que sai o vendedor, segundo o
          documento (§2).
        </Faixa>

        <Secao
          titulo="Os gatilhos"
          sub="Fonte: documento do Diego, mais um pedido do responsável. Estados conforme a análise de viabilidade do repositório."
        >
          <div className="space-y-2">
            {lista.map((g) => {
              const e = ESTILO[g.estado];
              return (
                <div
                  key={g.nome}
                  className="cartao cartao-alvo relative overflow-hidden px-4 py-3.5 pl-5"
                >
                  <span
                    aria-hidden
                    className={cn("absolute inset-y-0 left-0 w-[3px]", e.classeAresta)}
                  />

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <span className="text-[14.5px] font-semibold">{g.nome}</span>
                    <span className="selo">
                      {g.n === "extra" || g.n === "métrica" ? g.n : `regra ${g.n}`}
                    </span>
                    <span className="selo font-mono text-[11px]">{g.familia}</span>
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
          As 12 linhas colapsam em <strong>6 famílias</strong> de código, não 12 arquivos — manter
          uma por regra seria ter doze lugares para corrigir o mesmo bug de aritmética de datas.
          Três definições que travavam as regras 1, 3 e 8 foram respondidas pelo dono em
          <strong> 2026-08-27</strong> e já estão implementadas.
        </Nota>
      </div>
    </>
  );
}
