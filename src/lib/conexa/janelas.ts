/**
 * JANELAS TEMPORAIS DE SINCRONIZAÇÃO.
 *
 * Módulo PURO de propósito — sem Prisma, sem rede, sem env. É aritmética de
 * calendário e formato de filtro, que é exatamente onde bug se esconde, então
 * precisa ser testável sem subir nada.
 *
 * Substitui a paginação por offset puro, que tinha um buraco silencioso: uma
 * **deleção** no Conexa entre duas execuções desloca todos os registros para
 * trás, e o que ocupava a posição do cursor nunca é lido. Ao terminar, o
 * sistema apagava o cursor e declarava a entidade **completa** — a receita
 * derivada dela saía carimbada como fato. E como a paginação da API não devolve
 * total (medido), não havia conferência possível.
 *
 * Com janelas, o offset só percorre um mês por vez: o deslocamento fica contido
 * numa janela pequena, e reprocessar uma janela é barato e idempotente.
 * Completude passa a ser "todas as janelas concluídas", que é verificável e
 * re-executável — em vez de "o cursor chegou ao fim", que não é.
 *
 * ⚠ FORMATO DOS FILTROS — medido contra a API, não deduzido da documentação.
 *
 * A coleção Postman documenta `createdAtFrom/To` para `/charges`, e a API
 * devolve **zero** com ele. Já em `/sales`, `/customers` e `/room/bookings` o
 * mesmo filtro **funciona**, mas só no formato `Y-m-d\TH:i:sP` (ISO com offset
 * de fuso) — data pura devolve 400 com a mensagem
 * `"The format of createdAtFrom should be Y-m-d\TH:i:sP"`.
 *
 * Os filtros de DATA (`dueDate`, `startDate`) aceitam data pura.
 */

export type Entidade = "customers" | "contracts" | "charges" | "sales" | "bookings";

export interface DefinicaoEntidade {
  /** Caminho na API. */
  recurso: string;
  /** Prefixo do par de filtros: `${filtro}From` / `${filtro}To`. */
  filtro: string;
  /** `datetime` exige ISO com offset; `data` aceita `yyyy-MM-dd`. */
  formato: "data" | "datetime";
  /**
   * O campo pelo qual a janela corta é IMUTÁVEL?
   *
   * `createdAt` nunca muda: um registro jamais migra de janela. Já `dueDate` e
   * `startDate` podem ser editados no ERP — o registro **muda de janela** e uma
   * janela já concluída não o vê mais. Por isso as entidades mutáveis têm as
   * janelas VIZINHAS reprocessadas.
   *
   * ⚠ Isto responde "o registro troca de janela?", e nada mais. Durante meses
   * respondeu, por tabela, também a "o registro muda?" — e a resposta certa
   * para a segunda pergunta é *sempre sim*. Ver `mesesDeRevisita`.
   */
  imutavel: boolean;
  /**
   * Quantos meses para trás revisitar por MUDANÇA DE CONTEÚDO.
   *
   * ⚠ Medido contra a API em 2026-08-27 — amostra de 100 registros criados no
   * 1º semestre de 2024, comparando `createdAt` com `updatedAt`:
   *
   * | entidade        | alterados | p50 | p90  | máx  | além de 90d |
   * |-----------------|-----------|-----|------|------|-------------|
   * | `sales`         | 77%       | 28d | 120d | 356d | 22%         |
   * | `room/bookings` | 53%       |  4d |  15d |  86d | 0%          |
   * | `customers`     | —         |  —  |   —  |   —  | não expõe `updatedAt` |
   *
   * O que a medição derrubou: `sales` e `bookings` são `imutavel: true`, e isso
   * fazia o incremental revisitar **só a janela corrente**. Uma venda criada em
   * junho e cancelada em agosto nunca mais era lida — e mais de um quinto delas
   * muda depois de 90 dias. O espelho ficava com o estado do dia da carga, para
   * sempre, sem erro em lugar nenhum.
   *
   * Nenhuma rota aceita `updatedAtFrom` (verificado nas 43 rotas GET da coleção
   * Postman), então não existe "me dê o que mudou". Só revarrer.
   *
   * ⚠ `customers` não devolve `updatedAt`: a deriva dele é **não observável**.
   * O 6 abaixo é postura de risco, não medição — o cadastro carrega
   * `isActive`/`isBlocked`, que é o portão de elegibilidade de toda regra, e
   * errar ali oferta para cliente bloqueado. Anotado em `perguntas-abertas.md`.
   */
  mesesDeRevisita: number;
}

export const ENTIDADES: Record<Entidade, DefinicaoEntidade> = {
  customers: {
    recurso: "customers",
    filtro: "createdAt",
    formato: "datetime",
    imutavel: true,
    mesesDeRevisita: 6, // deriva não observável — ver a nota do campo
  },
  sales: {
    recurso: "sales",
    filtro: "createdAt",
    formato: "datetime",
    imutavel: true,
    mesesDeRevisita: 12, // p90 de 120 dias, máximo medido de 356
  },
  bookings: {
    recurso: "room/bookings",
    filtro: "createdAt",
    formato: "datetime",
    imutavel: true,
    mesesDeRevisita: 3, // p90 de 15 dias, ZERO alteração além de 90
  },
  // ⚠ `/charges` NÃO tem filtro por criação — medido. Sobra o vencimento, que é
  // mutável: uma cobrança cuja data de vencimento muda migra de janela.
  charges: {
    recurso: "charges",
    filtro: "dueDate",
    formato: "data",
    imutavel: false,
    mesesDeRevisita: 3,
  },
  // `/contracts` também não expõe criação; `startDate` é editável.
  contracts: {
    recurso: "contracts",
    filtro: "startDate",
    formato: "data",
    imutavel: false,
    mesesDeRevisita: 3,
  },
};

/**
 * ORDEM DE CARGA — por PORTÃO DE CONFIANÇA, não pela ordem em que as entidades
 * foram escritas no arquivo.
 *
 * ⚠ O teto de janelas por execução é GLOBAL, não por entidade: quem vem
 * primeiro come o orçamento inteiro. Na ordem anterior (a de declaração do
 * objeto) `sales` era a segunda — a maior entidade do espelho, ~68.500
 * registros — e `contracts` era a última. Resultado observado na primeira carga
 * real: depois de horas, `sales` em 10 janelas e `contracts` em 5, com a fila
 * do Radar parada esperando justamente `contracts`.
 *
 * O critério certo é *o que cada entidade destrava* (ver `completude.ts`):
 *
 * | Portão            | Exige                  | Destrava            |
 * |-------------------|------------------------|---------------------|
 * | `horasConfiavel`  | contracts + bookings   | a fila do Radar     |
 * | `receitaConfiavel`| customers + charges    | receita e Top 5     |
 *
 * `sales` não participa de nenhum portão — só do selo de completude. Por isso
 * vai por último: é a maior e a que menos destrava.
 */
export const ORDEM_DE_CARGA: Entidade[] = [
  "contracts",
  "bookings",
  "customers",
  "charges",
  "sales",
];

/** Fuso da empresa, fixo no formato que a API exige. */
const OFFSET = "-03:00";

/** `yyyy-MM` → os dois extremos no formato que o filtro daquela entidade exige. */
export function limitesDaJanela(
  janela: string,
  formato: "data" | "datetime",
): { de: string; ate: string } {
  const [ano, mes] = janela.split("-").map(Number);
  const ultimoDia = new Date(Date.UTC(ano!, mes!, 0)).getUTCDate();
  const primeiro = `${janela}-01`;
  const ultimo = `${janela}-${String(ultimoDia).padStart(2, "0")}`;

  if (formato === "data") return { de: primeiro, ate: ultimo };
  return { de: `${primeiro}T00:00:00${OFFSET}`, ate: `${ultimo}T23:59:59${OFFSET}` };
}

/** Todas as janelas mensais de `inicio` até `fim`, inclusive, mais antiga primeiro. */
export function gerarJanelas(inicio: string, fim: string): string[] {
  const [ai, mi] = inicio.split("-").map(Number);
  const [af, mf] = fim.split("-").map(Number);
  const out: string[] = [];
  let ano = ai!;
  let mes = mi!;
  for (let guarda = 0; guarda < 1200; guarda++) {
    const chave = `${ano}-${String(mes).padStart(2, "0")}`;
    out.push(chave);
    if (ano > af! || (ano === af! && mes >= mf!)) break;
    mes++;
    if (mes > 12) {
      mes = 1;
      ano++;
    }
  }
  return out;
}

/**
 * Janelas a reprocessar num ciclo incremental.
 *
 * Duas profundidades, porque as duas causas de desatualização têm prazos muito
 * diferentes e custos muito diferentes:
 *
 * - **rasa** — o que corre a cada ciclo (30 min). Cobre registro NOVO (nasce na
 *   janela corrente) e MIGRAÇÃO de janela (vencimento editado leva a cobrança
 *   para outro mês; por isso as vizinhas, só para as entidades mutáveis).
 *
 * - **profunda** — o que corre uma vez por dia. Cobre MUDANÇA DE CONTEÚDO em
 *   registro antigo: venda cancelada meses depois, reserva que virou `cancelled`,
 *   cliente bloqueado. Vai até `mesesDeRevisita`, que é medido por entidade.
 *
 * ⚠ A profunda NÃO roda a cada 30 minutos de propósito. Revarrer 12 meses de
 * `sales` custa centenas de requisições, e o dado que ela persegue muda com
 * mediana de 28 dias — buscar de meia em meia hora seria gastar o teto de taxa
 * para não descobrir nada. Frescura de meia hora para um fato que leva um mês
 * para acontecer é desperdício, não segurança.
 */
export function janelasIncrementais(
  entidade: Entidade,
  janelaAtual: string,
  mesesParaTras?: number,
  profundidade: "rasa" | "profunda" = "rasa",
): string[] {
  const def = ENTIDADES[entidade];
  const n =
    profundidade === "profunda"
      ? (mesesParaTras ?? def.mesesDeRevisita)
      : def.imutavel
        ? 0
        : (mesesParaTras ?? 3);
  const [ano, mes] = janelaAtual.split("-").map(Number);
  const out: string[] = [];
  for (let i = n; i >= 0; i--) {
    const d = new Date(Date.UTC(ano!, mes! - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  // Vencimento também pode ser empurrado para FRENTE.
  if (!def.imutavel) {
    const d = new Date(Date.UTC(ano!, mes!, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}
