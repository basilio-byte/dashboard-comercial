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
   * janelas recentes reprocessadas periodicamente.
   */
  imutavel: boolean;
}

export const ENTIDADES: Record<Entidade, DefinicaoEntidade> = {
  customers: { recurso: "customers", filtro: "createdAt", formato: "datetime", imutavel: true },
  sales: { recurso: "sales", filtro: "createdAt", formato: "datetime", imutavel: true },
  bookings: { recurso: "room/bookings", filtro: "createdAt", formato: "datetime", imutavel: true },
  // ⚠ `/charges` NÃO tem filtro por criação — medido. Sobra o vencimento, que é
  // mutável: uma cobrança cuja data de vencimento muda migra de janela.
  charges: { recurso: "charges", filtro: "dueDate", formato: "data", imutavel: false },
  // `/contracts` também não expõe criação; `startDate` é editável.
  contracts: { recurso: "contracts", filtro: "startDate", formato: "data", imutavel: false },
};

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
 * Para entidade IMUTÁVEL, basta a janela corrente (registro novo nasce nela).
 * Para entidade MUTÁVEL, também as anteriores: um vencimento editado move a
 * cobrança para outra janela, e a janela de destino precisa ser revisitada.
 */
export function janelasIncrementais(
  entidade: Entidade,
  janelaAtual: string,
  mesesParaTras = 3,
): string[] {
  const def = ENTIDADES[entidade];
  const n = def.imutavel ? 0 : mesesParaTras;
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
