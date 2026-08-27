import { CircleCheck, TriangleAlert, Ban, CircleDashed, type LucideIcon } from "lucide-react";
import { estadoDoEspelho } from "@/lib/intel/completude";
import { Cabecalho, Faixa, Nota, Secao } from "@/components/Cartao";
import { cn } from "@/lib/ui";
import { CategoriasClassificadas } from "./categorias";

export const dynamic = "force-dynamic";

/**
 * GATILHOS — o que dispara oferta, e o que ainda não dispara.
 *
 * Esta tela existe porque **fila vazia precisa ser interpretável**: sem ela,
 * "ninguém tem oportunidade hoje" e "o motor está desligado" têm a mesma
 * aparência, e a segunda é como uma automação morre sem ninguém perceber.
 *
 * ⚠ Os estados espelham a análise de viabilidade de
 * `docs/context/regras-comerciais.md`, cruzada com o que foi medido contra a
 * API. Eu cheguei a inventar aqui uma taxonomia paralela ("pronto para
 * implementar") e ela estava ERRADA em três regras — dizia pronto o que o
 * repositório já tinha analisado como tendo ressalva concreta. Uma tela que
 * discorda da análise do próprio projeto é pior que uma tela sem estado.
 *
 * Mudar estado aqui **obriga a mexer naquele documento também**, e vice-versa.
 * Foi o que aconteceu em 2026-08-27, quando as regras 2 e 9 passaram de
 * "ressalva" a bloqueio de permissão: a tela e o documento mudaram juntos. Os
 * dois divergirem em silêncio é como a taxonomia errada nasceu da primeira vez.
 */

/**
 * ⚠ Os quatro estados respondem **de quem é a próxima ação**, não "quanto falta".
 *
 * O quarto estado já se chamou `definicao` e aparecia como "aguarda conferência —
 * falta validar o saldo". Era falso desde 2026-08-27: não há conferência possível.
 * As horas do pacote vivem atrás de `/packages`, que responde **404 por permissão**
 * — ninguém dentro deste projeto pode destravar isso conferindo coisa alguma. Um
 * rótulo que pede uma ação impossível é pior que um rótulo que diz "bloqueado":
 * manda a pessoa procurar o trabalho onde ele não está.
 */
type Estado = "ligado" | "naFicha" | "ressalva" | "bloqueado";

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
      estado: "naFicha",
      nota: "função pura escrita e testada · a economia vs. avulso NÃO sai: o próprio documento (§3.1) registra que a API não expõe preço por hora por produto. A task sai com a lacuna declarada, nunca com número estimado",
    },
    {
      n: "10",
      nome: "Litoral reserva sala",
      condicao: "plano de Endereço Fiscal sem horas inclusas + fez reserva",
      oferta: "Pacote de Horas ou upgrade para Batial (2h/mês)",
      familia: "EVENTO_EM_SEGMENTO",
      estado: "naFicha",
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
      estado: reservasOk ? "naFicha" : "ressalva",
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
      estado: "naFicha",
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
      estado: "naFicha",
      nota: "decidido em 2026-08-27: ANIVERSÁRIO, não janela aberta — a diferença é entre uma oferta e cento e oitenta · identificação pela categoria, com a estação contando · produto confirmado na Fase 0 (3380/3381)",
    },
    {
      n: "2",
      nome: "Pacote de horas acabando",
      condicao: "saldo do pacote abaixo do limiar",
      oferta: "novo pacote",
      familia: "SALDO_COTA",
      estado: "bloqueado",
      nota: "medido em 2026-08-27: a hora do pacote vem de `recurringSales.packageId`, e `/packages` responde 404 POR PERMISSÃO — não existe caminho pela API. Dos 122 clientes com cota, 4 têm consumo acima do concedido, e os 4 têm pacote; nenhum sem pacote estoura. O saldo não é calculável com o token atual, e nenhuma conferência muda isso: só a liberação do endpoint pelo admin do Conexa",
    },
    {
      n: "9",
      nome: "Pacote abaixo de 5h",
      condicao: "saldo do pacote menor que 5h",
      oferta: "novo pacote",
      familia: "SALDO_COTA",
      estado: "bloqueado",
      nota: "mesma mecânica da regra 2, outro limiar — as duas destravam juntas, no dia em que `/packages` responder",
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
  naFicha: {
    classeSelo: "selo-info",
    classeAresta: "bg-[var(--acento)]",
    Icone: CircleDashed,
    rotulo: "só na ficha",
    deQuem: "avaliado por cliente, sem fila",
  },
  ressalva: {
    classeSelo: "selo-atencao",
    classeAresta: "bg-[var(--atencao)]",
    Icone: TriangleAlert,
    rotulo: "com ressalva",
    deQuem: "falta uma decisão nossa",
  },
  bloqueado: {
    classeSelo: "selo-critico",
    classeAresta: "bg-[var(--critico)]",
    Icone: Ban,
    rotulo: "bloqueado por terceiro",
    deQuem: "depende do admin do Conexa",
  },
};

const ORDEM_RESUMO: Estado[] = ["ligado", "naFicha", "ressalva", "bloqueado"];

export default async function Gatilhos() {
  const espelho = await estadoDoEspelho();
  const reservasOk = espelho.entidades.find((e) => e.entidade === "bookings")?.completa ?? false;
  const lista = gatilhos(espelho.horasConfiavel, reservasOk);
  const contagem = (e: Estado) => lista.filter((g) => g.estado === e).length;
  const ligados = contagem("ligado");
  // ⚠ "1 de 12 disparando" era enganoso: `sinaisDoCliente()` avalia na ficha do
  // cliente TODAS menos as bloqueadas — o que não chega é a fila que varre a base.
  // O selo passa a contar o que de fato chega ao Radar, e o subtítulo diz o resto,
  // em vez de esconder as outras atrás de um "não".
  //
  // Derivado de `contagem`, não escrito à mão: um "10 de 12" cravado aqui vira
  // mentira no dia em que uma regra mudar de estado, que é justamente o dia em que
  // ninguém vai reler este arquivo.
  const avaliados = lista.length - contagem("bloqueado");

  return (
    <>
      <Cabecalho
        titulo="Gatilhos"
        sub={
          <>
            O que dispara uma oferta — e, principalmente, o que ainda <strong>não</strong> dispara.
            Uma fila vazia só quer dizer alguma coisa quando se sabe o que está ligado.{" "}
            <strong>{avaliados}</strong> dos {lista.length} já são avaliados na ficha de cada
            cliente; <strong>{ligados}</strong> {ligados === 1 ? "chega" : "chegam"} ao Radar.
          </>
        }
        acao={
          <span className={cn("selo", ligados > 0 ? "selo-bom" : "selo-atencao")}>
            {ligados} {ligados === 1 ? "chega" : "chegam"} ao Radar
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

        {/* ⚠ Sem número de teste aqui. A faixa dizia "26 testes" e eram 34 — uma
            constante em JSX que descreve o código deriva sempre, e derivar num
            lugar que serve justamente para provar rigor é o pior lugar. */}
        <Faixa tom="info">
          <strong>As regras já existem como funções puras testadas</strong> —{" "}
          <code className="rounded-sm bg-[var(--superficie-sutil)] px-1 py-px">
            src/lib/regras/familias.ts
          </code>
          . O gargalo <strong>não é mais escrever regra</strong>: é que o sinal só aparece{" "}
          <strong>abrindo cliente por cliente</strong>. Numa amostra de 10 clientes, 6 tinham
          sinal ativo — com milhares de clientes, um sinal que exige abrir a ficha é o mesmo que
          não existir. O que falta é a <strong>fila que varre a base</strong> (
          <code className="rounded-sm bg-[var(--superficie-sutil)] px-1 py-px">
            src/lib/regras/fila.ts
          </code>
          , escrita e ainda sem consumidor). O disparo no ClickUp vem depois, por decisão do
          responsável: validar tudo dentro do painel primeiro.
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

        <CategoriasClassificadas />

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
