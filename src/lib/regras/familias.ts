import { addMesesClamp } from "@/lib/metrics/horas";
import { money, type Money } from "@/lib/money";

/**
 * AS FAMÍLIAS DE REGRA — funções PURAS.
 *
 * O documento do Diego (§2, "Camada de regras") pede exatamente isto: *"cada
 * regra da tabela acima vira uma função de verificação simples que roda sobre o
 * dataset consolidado. São checagens determinísticas de data/threshold, não
 * precisam de modelo de IA para decidir."*
 *
 * As 10 regras colapsam em 6 famílias (ADR-0007). Manter 10 arquivos seria ter
 * 10 lugares para corrigir o mesmo bug de aritmética de datas.
 *
 * ⚠ Sem Prisma, sem rede, sem `Date.now()`. Tudo entra por parâmetro — inclusive
 * "hoje" —, porque regra que lê o relógio sozinha não é testável, e uma regra
 * não testável dispara oferta errada para cliente real.
 *
 * ⚠ Todo limiar é PARÂMETRO, nunca constante. O documento diz "cair X% de um
 * mês para outro": o X é do cliente, não do desenvolvedor. Ver a memória sobre
 * configuração morar na UI.
 */

// ---------------------------------------------------------------------------
// MARCO_CONTRATO — regras 1, 6, 7 e 8
// ---------------------------------------------------------------------------

/**
 * O contrato completou N meses?
 *
 * ⚠ **Âncora decidida pelo dono em 2026-08-27: `startDate`.** A pergunta estava
 * aberta desde a Fase 0 porque `startDate` e `fidelityDate` **divergem nos
 * dados reais** — e a escolha muda quem entra na fila. Quem chama passa a data
 * já escolhida; esta função não decide âncora.
 *
 * ⚠ **Regra 8 é ANIVERSÁRIO, não janela aberta** — também decidido em
 * 2026-08-27. "Até o 6º mês" dispara NO marco dos 6 meses, com a tolerância
 * abaixo, e não todo dia do 1º ao 6º mês. A diferença é entre uma oferta e
 * cento e oitenta.
 *
 * A tolerância existe porque o job roda uma vez por dia: sem ela, um marco que
 * caia num dia de falha da carga é perdido para sempre.
 */
export function marcoAtingido(p: {
  inicio: Date;
  meses: number;
  hoje: Date;
  toleranciaDias: number;
}): boolean {
  const aniversario = addMesesClamp(p.inicio, p.meses);
  const limite = new Date(aniversario);
  limite.setUTCDate(limite.getUTCDate() + p.toleranciaDias);
  return p.hoje >= aniversario && p.hoje <= limite;
}

// ---------------------------------------------------------------------------
// TENDENCIA — regras 3 e 11
// ---------------------------------------------------------------------------

export interface PontoMensal {
  /** 'yyyy-MM'. */
  mesKey: string;
  valor: Money;
}

/**
 * Regra 3 — padrão de compra irregular.
 *
 * ⚠ **Definido pelo dono em 2026-08-27: "mês a mês".** Leio como *queda em
 * meses CONSECUTIVOS*, que é o que o exemplo do próprio documento mostra —
 * "comprou 20h em jun, 10h em jul, nada em ago": três meses, duas quedas
 * seguidas. Por isso `quedasSeguidas` tem default 2 e é parâmetro: se o
 * significado pretendido for outro número, muda num lugar só.
 *
 * ⚠ Só meses FECHADOS. O mês em curso está pela metade e faria a base inteira
 * parecer em queda todo dia 1º.
 *
 * ⚠ Zero no meio da série **conta como queda** (é o "nada em ago" do exemplo),
 * mas uma série que começa em zero não é queda: é ausência de base.
 */
export function quedaMesAMes(p: {
  serie: PontoMensal[];
  quedasSeguidas?: number;
  /**
   * Quanto um mês precisa cair em relação ao anterior para CONTAR como queda.
   *
   * ⚠ Medido em produção em 2026-09-18: sem isso, R$ 86,01 → R$ 84,14 (−2%)
   * contava como queda. Os quatro sinais da regra 3 na produção eram todos um
   * pico de cobrança dupla seguido de uma oscilação de centavos — "2 quedas
   * seguidas" em clientes com receita estável. Default 0 aqui preserva a função
   * pura; quem define o valor de verdade é o parâmetro do gatilho.
   */
  quedaMinimaPct?: number;
}): { disparou: boolean; quedas: number; de: string | null; ate: string | null } {
  const exigidas = p.quedasSeguidas ?? 2;
  const minima = Math.abs(p.quedaMinimaPct ?? 0);
  const serie = [...p.serie].sort((a, b) => a.mesKey.localeCompare(b.mesKey));
  const nulo = { disparou: false, quedas: 0, de: null, ate: null };
  if (serie.length < exigidas + 1) return nulo;

  // Conta as quedas consecutivas terminando no mês mais recente: o padrão que
  // interessa é o que está acontecendo AGORA, não um vale de dois anos atrás.
  let quedas = 0;
  for (let i = serie.length - 1; i > 0; i--) {
    const atual = serie[i]!;
    const anterior = serie[i - 1]!;
    if (anterior.valor.lessThanOrEqualTo(0)) break; // sem base de comparação
    if (atual.valor.greaterThanOrEqualTo(anterior.valor)) break;
    const quedaPct = Number(anterior.valor.minus(atual.valor).div(anterior.valor).times(100));
    if (quedaPct < minima) break; // oscilação, não queda
    quedas++;
  }

  if (quedas < exigidas) return { disparou: false, quedas, de: null, ate: null };
  return {
    disparou: true,
    quedas,
    de: serie[serie.length - 1 - quedas]!.mesKey,
    ate: serie[serie.length - 1]!.mesKey,
  };
}

/**
 * Regra 11 (bônus) — a métrica "alerta se cair X% de um mês para outro", do
 * documento do Diego (§1, Métricas).
 *
 * ⚠ `anterior <= 0` NÃO é queda de 100%: é ausência de base. Confundir os dois
 * marcaria como despencando todo cliente que faturou pela primeira vez.
 */
export function quedaPercentual(p: {
  atual: Money;
  anterior: Money;
  limiarPct: number;
}): { disparou: boolean; variacaoPct: number | null } {
  if (p.anterior.lessThanOrEqualTo(0)) return { disparou: false, variacaoPct: null };
  const variacao = Number(p.atual.minus(p.anterior).div(p.anterior).times(100));
  return { disparou: variacao <= -Math.abs(p.limiarPct), variacaoPct: variacao };
}

/**
 * Média APARADA: tira o menor e o maior e tira a média do resto.
 *
 * Complementa a mediana. A mediana aguenta um pico isolado mas se engana com
 * troca de RITMO de cobrança — 180, 0, 180, 0 (bimestral) dá mediana 90 ou 180
 * conforme a janela, e o cliente paga os mesmos R$ 90/mês. A média aparada lê
 * esse caso certo e se engana com dois picos. Usadas juntas (ver
 * `quedaSustentada`), uma cobre o ponto cego da outra.
 */
export function mediaAparada(valores: Money[]): Money | null {
  if (!valores.length) return null;
  const ord = [...valores].sort((a, b) => a.comparedTo(b));
  const miolo = ord.length >= 4 ? ord.slice(1, -1) : ord;
  return miolo.reduce((acc, v) => acc.plus(v), money(0)).div(miolo.length);
}

/** Mediana de valores monetários. Lista vazia devolve `null`, nunca zero. */
export function mediana(valores: Money[]): Money | null {
  if (!valores.length) return null;
  const ord = [...valores].sort((a, b) => a.comparedTo(b));
  const meio = Math.floor(ord.length / 2);
  return ord.length % 2 ? ord[meio]! : ord[meio - 1]!.plus(ord[meio]!).div(2);
}

/**
 * A métrica do §1 — "cair X%" — contra uma BASE, não contra o mês anterior.
 *
 * ⚠ Medido em produção em 2026-09-18: os 6 sinais de "queda de receita" eram
 * todos artefato de cobrança. O regime é de EMISSÃO, e um mês em que o Conexa
 * emite duas cobranças vira pico; a volta ao normal lia como "−50%" — quatro
 * clientes com receita estável caíram "−50%" no mesmo agosto. O contrato ANUAL
 * fazia pior: uma cobrança em julho, zero em agosto, "−100%".
 *
 * Com a mediana dos meses anteriores, um pico isolado não vira base: 148, 148,
 * 297, 148 compara 148 com 148. E o anual se resolve sozinho — 0, 0, 900, 0 tem
 * mediana zero, que é "sem base", não queda. Isso dispensou excluir os 328
 * contratos anuais da análise, que era a outra saída e escondia um terço da base.
 *
 * Uma queda de verdade continua disparando: 1000, 1000, 1000, 500 dá −50%.
 */
export function quedaContraBase(p: {
  /** Meses FECHADOS, em qualquer ordem. O último (mais recente) é o avaliado. */
  serie: PontoMensal[];
  /** Quantos meses antes do avaliado formam a base. */
  mesesDeBase: number;
  limiarPct: number;
}): {
  disparou: boolean;
  variacaoPct: number | null;
  base: Money | null;
  mesAvaliado: string | null;
  /** Por que não houve comparação, quando não houve. */
  semBase: "SERIE_CURTA" | "BASE_ZERO" | null;
} {
  const serie = [...p.serie].sort((a, b) => a.mesKey.localeCompare(b.mesKey));
  const n = Math.max(1, p.mesesDeBase);
  if (serie.length < n + 1) {
    return { disparou: false, variacaoPct: null, base: null, mesAvaliado: null, semBase: "SERIE_CURTA" };
  }
  const avaliado = serie[serie.length - 1]!;
  const base = mediana(serie.slice(-(n + 1), -1).map((x) => x.valor))!;
  if (base.lessThanOrEqualTo(0)) {
    return { disparou: false, variacaoPct: null, base, mesAvaliado: avaliado.mesKey, semBase: "BASE_ZERO" };
  }
  const r = quedaPercentual({ atual: avaliado.valor, anterior: base, limiarPct: p.limiarPct });
  return { ...r, base, mesAvaliado: avaliado.mesKey, semBase: null };
}

// ---------------------------------------------------------------------------
// USO_SEM_COTA — regra 4
// ---------------------------------------------------------------------------

/**
 * Regra 4 — avulso com uso alto.
 *
 * "Cliente só compra hora avulsa, mas usou >5h no mês."
 *
 * ⚠ "Só compra avulsa" = **nenhum contrato ativo com cota**. Não é o mesmo que
 * "não tem contrato": o Endereço Fiscal Litoral tem contrato e não tem cota, e
 * é justamente ele quem paga tudo por fora.
 *
 * ⚠ A oferta pede "mostrar economia vs. avulso", e o próprio documento do Diego
 * registra em §3.1 que a API **não expõe preço por hora a nível de produto**.
 * A regra dispara mesmo assim; quem monta a task declara a economia como lacuna
 * em vez de estimar. Nunca com número inventado.
 */
export function usoAvulsoAlto(p: {
  temContratoComCota: boolean;
  horasNoMes: Money;
  limiarHoras?: number;
}): boolean {
  if (p.temContratoComCota) return false;
  return p.horasNoMes.greaterThan(p.limiarHoras ?? 5);
}

/**
 * O cliente TEM cota de horas, a julgar pelo que o próprio Conexa fez?
 *
 * ⚠ Medido em produção em 2026-09-18: as regras 4 e 10 ofertavam "pacote de
 * horas" a UP Psicologia, Segantini, INDRA, Thiago e Isadora — e as reservas
 * deles vinham com `status: "deductedFromQuota"`, o Conexa abatendo de uma cota.
 * A cota é de PACOTE (`recurringSales.packageId`), que o espelho não sincroniza
 * e cujo conteúdo a API não expõe. A regra olhava só contrato e plano, via "sem
 * cota", e reofertava exatamente o que o cliente já tinha.
 *
 * A reserva abatida é a prova de posse que já está no dado — é o mesmo
 * raciocínio do ADR-0005: o ERP já respondeu a pergunta. A janela é recente de
 * propósito: abatimento de um ano atrás prova um pacote que pode ter acabado.
 */
export function temEvidenciaDeCota(p: {
  reservas: Array<{ status?: string | null; dataLocal?: Date | null; isActive?: boolean; cancellationReason?: string | null }>;
  desde: Date;
}): boolean {
  return p.reservas.some(
    (r) =>
      r.status === "deductedFromQuota" &&
      r.isActive !== false &&
      !r.cancellationReason &&
      !!r.dataLocal &&
      r.dataLocal >= p.desde,
  );
}

/**
 * A reserva é HORA AVULSA — o cliente paga por ela, fora de qualquer cota?
 *
 * ⚠ **Corrigido em 2026-09-18, no mesmo dia da primeira versão.** A primeira
 * versão usava o STATUS da reserva (billed / paid / partiallyPaid) e tratava
 * `notBilled` como "não cobrada". Medido depois: a partir de agosto de 2026 a
 * Seahub passou a cobrar sala numa fatura CONSOLIDADA do mês seguinte — as
 * vendas de agosto estão em cobranças que vencem de 9 a 25 de setembro, R$ 9,4
 * mil já pagos —, e o Conexa mantém a reserva como `notBilled` mesmo assim.
 * Resultado: todo uso avulso do mês corrente parecia "não cobrado", e a regra
 * 4 zerou. Pelo critério certo, 4 clientes; pelo errado, nenhum.
 *
 * O critério certo é o que a reserva CUSTA, não o estado da cobrança: tem venda
 * ligada com valor e não foi abatida da cota. Venda de valor zero é cortesia —
 * esse é o único caso em que o cliente de fato não paga pela hora.
 */
export function ehHoraAvulsa(r: {
  status?: string | null;
  /** Valor da venda ligada à reserva (`saleConexaId`). `null` = sem venda. */
  valorDaVenda: number | null;
}): boolean {
  if (r.status === "deductedFromQuota") return false;
  if (r.status === "cancelled" || r.status === "billedCancelled") return false;
  return r.valorDaVenda !== null && r.valorDaVenda > 0;
}

// ---------------------------------------------------------------------------
// PRIMEIRO_EVENTO — regra 5
// ---------------------------------------------------------------------------

/**
 * Regra 5 — primeira reserva de sala.
 *
 * ⚠ **Risco de disparo em massa.** Sem histórico completo de reservas, todo
 * cliente antigo parece estreante e a regra criaria milhares de tasks de uma
 * vez. Por isso `dataDeCorte` é obrigatório: só conta como estreia o que
 * acontece DEPOIS do corte, e o corte só faz sentido com o selo de completude
 * das reservas — que fechou em 2026-08-27 (37/37 janelas).
 */
export function primeiraReserva(p: {
  primeiraReservaEm: Date | null;
  hoje: Date;
  dataDeCorte: Date;
  toleranciaDias: number;
}): boolean {
  if (!p.primeiraReservaEm) return false;
  if (p.primeiraReservaEm < p.dataDeCorte) return false; // estreia antiga: não é evento
  const limite = new Date(p.primeiraReservaEm);
  limite.setUTCDate(limite.getUTCDate() + p.toleranciaDias);
  return p.hoje >= p.primeiraReservaEm && p.hoje <= limite;
}

// ---------------------------------------------------------------------------
// EVENTO_EM_SEGMENTO — regra 10
// ---------------------------------------------------------------------------

/**
 * Regra 10 — Endereço Litoral que reserva sala.
 *
 * ⚠ O tier vem da **cota do plano**, não do nome do produto. Medido na Fase 0:
 * Litoral = `hourQuotas` nulo · Batial = 2h · Abissal = 8h. Classificar por
 * substring do nome seria inventar dado, e o catálogo tem grafias divergentes
 * ("Endereço Fiscal de Comércio" vs "De Comercio").
 *
 * Por isso a entrada é `temPlanoFiscalSemCota` — um fato estrutural — e não o
 * nome do plano.
 */
export function litoralReservouSala(p: {
  temPlanoFiscalSemCota: boolean;
  reservasNoPeriodo: number;
}): boolean {
  return p.temPlanoFiscalSemCota && p.reservasNoPeriodo > 0;
}

// ---------------------------------------------------------------------------
// Classificação de segmento — insumo das regras 1, 6, 7, 8 e 10
// ---------------------------------------------------------------------------

/**
 * Normaliza para comparar: minúsculas, sem acento, sem espaço sobrando.
 *
 * O catálogo tem grafias divergentes para a mesma coisa — a Fase 0 achou
 * "Endereço Fiscal de Comércio" e "Endereço Fiscal De Comercio" convivendo.
 */
function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * A CATEGORIA do plano é de sala privativa?
 *
 * ⚠ Decidido pelo dono em 2026-08-27: **classificar pela CATEGORIA do plano, e
 * a estação de coworking CONTA**. A dúvida era concreta — a categoria "Salas
 * Privativas - Seaway Center" inclui "Estação 01 - Coworking L21", que não é
 * uma sala. A resposta é que a categoria inteira vale.
 *
 * ⚠ Isto NÃO é o "chute por nome de produto" que o projeto proíbe. A diferença
 * importa: inferir pelo nome do PRODUTO é adivinhar ("Panteão" é qual
 * segmento?); ler o nome da CATEGORIA DE SERVIÇO é usar o campo que a API
 * expõe exatamente para classificar — `contrato → plano → serviceCategory`, que
 * é a fórmula do próprio `docs/context/regras-comerciais.md`.
 *
 * Ainda assim, casar por substring envelhece: se a Seahub renomear a categoria,
 * as regras 6, 7 e 8 silenciam. Por isso a tela Gatilhos mostra quais
 * categorias foram classificadas, para a falha ser visível em vez de silenciosa.
 */
export function ehSegmentoPrivativa(nomeCategoria: string | null | undefined): boolean {
  if (!nomeCategoria) return false;
  return normalizar(nomeCategoria).includes("privativ");
}

/**
 * A categoria é a do SeaBox?
 *
 * ⚠ Achado lendo o catálogo real do projeto irmão em 2026-08-27: **o SeaBox tem
 * categoria de serviço PRÓPRIA** no Conexa, com cinco produtos (3156, 3157 na
 * SEAHUB; 3178, 3179, 3182 na SEATECH).
 *
 * Isso muda a supressão das regras 5 e 7 de adivinhação para consulta: "o
 * cliente já comprou SeaBox?" vira categoria do produto vendido, não casamento
 * de nome. Continua faltando o outro lado — quais planos o embutem de cortesia
 * —, que não existe na API e é cadastro.
 */
export function ehSegmentoSeaBox(nomeCategoria: string | null | undefined): boolean {
  if (!nomeCategoria) return false;
  return normalizar(nomeCategoria).includes("seabox");
}

/**
 * A categoria do plano é de Endereço Fiscal? Insumo das regras 1 e 10.
 *
 * ⚠ O TIER (Litoral / Batial / Abissal) **não** sai daqui — sai da cota do
 * plano, medido na Fase 0. Esta função responde só "é Fiscal?".
 */
export function ehSegmentoFiscal(nomeCategoria: string | null | undefined): boolean {
  if (!nomeCategoria) return false;
  const n = normalizar(nomeCategoria);
  return n.includes("endereco fiscal") || n.includes("fiscal");
}

// ---------------------------------------------------------------------------
// SUPRESSÃO — "não ofertar o que o cliente já tem"
// ---------------------------------------------------------------------------

/**
 * O cliente já tem o produto que a regra ia ofertar?
 *
 * ⚠ Esta é a pergunta que a especificação do Diego **nunca faz**. Ela diz
 * quando ofertar, jamais quando NÃO ofertar — e é aí que uma automação
 * queima a confiança do vendedor: ofertando ao cliente o que ele acabou de
 * comprar.
 *
 * ⚠ **Duas vias de posse, informadas pelo dono em 2026-08-27:** o SeaBox é um
 * produto vendável, *"mas alguns outros produtos fornecem o SeaBox como
 * cortesia na assinatura"*. Então "já tem" não é só "comprou" — pode ter vindo
 * embutido no plano, sem nenhuma venda para rastrear.
 *
 * As duas vias têm procedências diferentes, e isso importa:
 *
 * - **compra** → sai de `/sales`, é fato da API
 * - **cortesia** → NÃO existe na API. É cadastro: alguém precisa declarar quais
 *   produtos embutem quais. Enquanto o plano do cliente não estiver mapeado, a
 *   resposta é `DESCONHECIDO` — nunca "não possui".
 *
 * `DESCONHECIDO` não deixa a regra disparar. É a mesma regra de ouro do resto
 * do projeto: nada dispara sobre dado de procedência indisponível. O custo de
 * silenciar uma oferta legítima é menor que o de reofertar uma cortesia que o
 * cliente já recebeu.
 */
export type Posse = "POR_COMPRA" | "POR_CORTESIA" | "NAO_POSSUI" | "DESCONHECIDO";

export function posseDoProduto(p: {
  produtoAlvo: number;
  /** `productId` já vendidos a este cliente. Vem de `/sales`. */
  comprados: number[];
  /**
   * `productId` que o plano do cliente embute de cortesia.
   *
   * `null` = o plano ainda NÃO foi mapeado. Diferente de `[]`, que significa
   * "mapeado, e não embute nada".
   */
  cortesiasDoPlano: number[] | null;
}): Posse {
  if (p.comprados.includes(p.produtoAlvo)) return "POR_COMPRA";
  if (p.cortesiasDoPlano === null) return "DESCONHECIDO";
  if (p.cortesiasDoPlano.includes(p.produtoAlvo)) return "POR_CORTESIA";
  return "NAO_POSSUI";
}

/** Só `NAO_POSSUI` libera a oferta. Ambíguo e desconhecido seguram. */
export function podeOfertar(posse: Posse): boolean {
  return posse === "NAO_POSSUI";
}

// ---------------------------------------------------------------------------
// TENDENCIA — queda SUSTENTADA (a métrica, desde 2026-09-18)
// ---------------------------------------------------------------------------

/**
 * A receita ficou abaixo do normal por MAIS DE UM mês?
 *
 * ⚠ Terceira versão da métrica, e o motivo é medido. A primeira comparava um
 * mês com o anterior; a segunda, um mês com a mediana dos anteriores. As duas
 * erravam no mesmo ponto: avaliar UM mês isolado no regime de emissão, onde um
 * mês sozinho pode vir zerado por renegociação, dobrado por emissão antecipada,
 * ou deslocado porque a sala passou a ser cobrada no mês seguinte (ago/2026).
 * Com base de 6 meses ficou PIOR — 17 sinais contra 14.
 *
 * Agora: os `mesesAvaliados` últimos meses fechados precisam TODOS estar abaixo
 * de `(1 − limiar)` × a mediana dos `mesesDeBase` anteriores. Um mês atípico
 * não basta mais; dois seguidos, sim.
 *
 * ⚠ O mês em curso só pode DESMENTIR, nunca criar. Se o mês que ainda não
 * fechou já alcançou o normal, a queda dos anteriores era calendário — foi o
 * caso dos que renegociaram e pagaram tudo de uma vez em setembro. Mas mês pela
 * metade nunca dispara alerta: faria a base inteira "cair" todo dia 1º.
 */
export function quedaSustentada(p: {
  serie: PontoMensal[];
  mesesAvaliados: number;
  mesesDeBase: number;
  limiarPct: number;
  /** Receita do mês em curso até agora. `null` = não informado. */
  mesEmCurso?: Money | null;
  /** Abaixo desta base (R$/mês) não se fala em queda. */
  baseMinima?: number;
}): {
  disparou: boolean;
  variacaoPct: number | null;
  base: Money | null;
  avaliados: string[];
  semBase: "SERIE_CURTA" | "BASE_ZERO" | "BASE_PEQUENA" | null;
  desmentidoPeloMesEmCurso: boolean;
  /** Quanto se perdeu por mês em relação à base — para ordenar a fila. */
  perdaPorMes: Money | null;
} {
  const serie = [...p.serie].sort((a, b) => a.mesKey.localeCompare(b.mesKey));
  const nAval = Math.max(1, p.mesesAvaliados);
  // Base mínima de 3: menos que isso, mediana é só "um dos valores".
  const nBase = Math.min(Math.max(3, p.mesesDeBase), Math.max(0, serie.length - nAval));
  const nulo = {
    disparou: false,
    variacaoPct: null,
    base: null,
    avaliados: [] as string[],
    desmentidoPeloMesEmCurso: false,
    perdaPorMes: null,
  };
  if (serie.length < nAval + 3) return { ...nulo, semBase: "SERIE_CURTA" };

  const avaliados = serie.slice(-nAval);
  const valoresDaBase = serie.slice(-(nAval + nBase), -nAval).map((x) => x.valor);
  // ⚠ A MENOR das duas leituras robustas do normal. Só é queda o que cai
  // abaixo das duas — a mediana aguenta pico isolado, a média aparada aguenta
  // troca de ritmo de cobrança (medido: Plenitus passou de bimestral a mensal,
  // pagando o mesmo, e a mediana sozinha acusava −33%).
  const med = mediana(valoresDaBase)!;
  const apar = mediaAparada(valoresDaBase)!;
  const base = med.lessThan(apar) ? med : apar;
  const meses = avaliados.map((a) => a.mesKey);
  if (base.lessThanOrEqualTo(0)) return { ...nulo, avaliados: meses, base, semBase: "BASE_ZERO" };
  if (p.baseMinima !== undefined && base.lessThan(p.baseMinima)) {
    return { ...nulo, avaliados: meses, base, semBase: "BASE_PEQUENA" };
  }

  const teto = base.times(1 - Math.abs(p.limiarPct) / 100);
  const media = avaliados
    .reduce((acc, a) => acc.plus(a.valor), money(0))
    .div(avaliados.length);
  const variacaoPct = Number(media.minus(base).div(base).times(100));
  const todosAbaixo = avaliados.every((a) => a.valor.lessThanOrEqualTo(teto));
  const desmentido = !!p.mesEmCurso && p.mesEmCurso.greaterThan(teto);

  return {
    disparou: todosAbaixo && !desmentido,
    variacaoPct,
    base,
    avaliados: meses,
    semBase: null,
    desmentidoPeloMesEmCurso: todosAbaixo && desmentido,
    perdaPorMes: base.minus(media),
  };
}

// ---------------------------------------------------------------------------
// MUDANCA_CONTRATO — perdeu o contrato, ou trocou por um menor
// ---------------------------------------------------------------------------

export interface ContratoParaValor {
  conexaId: number;
  amount: Money;
  paymentFrequency: string | null;
  startDate: Date | null;
  endDate: Date | null;
  isActive: boolean;
  /**
   * Contrato de categoria PROGRAMA (ou IGNORAR): não conta como permanência.
   * O fim dele é conclusão, não saída — ver o modo `concluiu`.
   */
  foraDaPermanencia?: boolean;
}

const MESES_DA_PERIODICIDADE: Record<string, number> = {
  Monthly: 1,
  Bimonthly: 2,
  Quarterly: 3,
  Semester: 6,
  Yearly: 12,
};

/**
 * Valor MENSAL de um contrato. Anual de R$ 1.200 vale R$ 100/mês.
 *
 * ⚠ Sem isso, trocar um contrato anual por um mensal pareceria uma queda de
 * 92% — e 328 dos contratos ativos são anuais.
 */
export function valorMensalDoContrato(c: Pick<ContratoParaValor, "amount" | "paymentFrequency">): Money {
  return c.amount.div(MESES_DA_PERIODICIDADE[c.paymentFrequency ?? "Monthly"] ?? 1);
}

/**
 * Quanto o cliente tinha contratado, por mês, numa data.
 *
 * Um contrato vale na data quando começou até ela e ainda não tinha terminado.
 * Sem data de fim, vale enquanto estiver ativo — são 1.338 contratos assim, e é
 * por isso que "contrato vencendo" quase nunca avisa nada.
 */
export function valorContratadoEm(contratos: ContratoParaValor[], data: Date): Money | null {
  let total: Money | null = null;
  for (const c of contratos) {
    if (!c.startDate || c.startDate > data) continue;
    const vale = c.endDate ? c.endDate > data : c.isActive;
    if (!vale) continue;
    const v = valorMensalDoContrato(c);
    total = total ? total.plus(v) : v;
  }
  return total;
}

/**
 * O cliente perdeu o contrato, ou passou a pagar menos, nos últimos N dias?
 *
 * ⚠ É FATO, não inferência — e foi o sinal mais limpo medido em 2026-09-18.
 * Das 6 trocas de contrato em 45 dias, 4 eram reduções reais, entre elas as
 * duas maiores quedas que a métrica de receita tinha achado (R$ 2.000 → R$ 119
 * e R$ 1.900 → R$ 99,90) — aqui sem ruído nenhum. As outras 2 eram renovação
 * pelo mesmo valor, que este cálculo corretamente não aponta.
 */
export function mudancaDeContrato(p: {
  contratos: ContratoParaValor[];
  hoje: Date;
  janelaDias: number;
  limiarPct: number;
}): {
  perdeu: boolean;
  reduziu: boolean;
  /** Um contrato de PROGRAMA terminou na janela e não há permanência vigente. */
  concluiu: boolean;
  antes: Money | null;
  agora: Money | null;
  variacaoPct: number | null;
  /** O contrato de permanência que terminou dentro da janela, quando há. */
  encerrado: ContratoParaValor | null;
  /** O contrato de programa que terminou dentro da janela, quando há. */
  programaEncerrado: ContratoParaValor | null;
} {
  const desde = new Date(p.hoje);
  desde.setUTCDate(desde.getUTCDate() - p.janelaDias);

  // ⚠ Programa não é permanência: o fim da turma do Hub Empreendedoras não pode
  // aparecer como "perdeu o contrato" (8 de 23 eram isso, em 2026-09-18).
  const permanencia = p.contratos.filter((c) => !c.foraDaPermanencia);
  const programas = p.contratos.filter((c) => c.foraDaPermanencia);

  const antes = valorContratadoEm(permanencia, desde);
  const agora = valorContratadoEm(permanencia, p.hoje);
  const terminouNaJanela = (c: ContratoParaValor) => !!c.endDate && c.endDate > desde && c.endDate <= p.hoje;
  const maisRecente = (l: ContratoParaValor[]) =>
    l.filter(terminouNaJanela).sort((a, b) => b.endDate!.getTime() - a.endDate!.getTime())[0] ?? null;
  const encerrado = maisRecente(permanencia);
  const programaEncerrado = maisRecente(programas);

  const temAntes = !!antes && antes.greaterThan(0);
  const temAgora = !!agora && agora.greaterThan(0);
  const variacaoPct = temAntes ? Number((agora ?? money(0)).minus(antes!).div(antes!).times(100)) : null;

  return {
    // Perdeu: tinha, não tem mais, e um contrato terminou dentro da janela —
    // sem esta última condição, cliente que nunca teve contrato vigente na
    // data de referência também "perderia".
    perdeu: temAntes && !temAgora && !!encerrado,
    reduziu:
      temAntes && temAgora && variacaoPct !== null && variacaoPct <= -Math.abs(p.limiarPct),
    concluiu: !!programaEncerrado && !temAgora,
    antes,
    agora,
    variacaoPct,
    encerrado,
    programaEncerrado,
  };
}

// ---------------------------------------------------------------------------
// SAUDE_FINANCEIRA — o FREIO das ofertas de venda
// ---------------------------------------------------------------------------

/**
 * Status de cobrança EM ABERTO — emitida, não paga, não cancelada.
 *
 * ⚠ Não é só `unpaid`. Medido em 2026-09-18: 734 das 735 cobranças `denied` do
 * último ano estão vencidas, e nenhuma tem pagamento — na prática é cobrança
 * vencida e não paga. O freio olhava só `unpaid`, e o primeiro do Radar
 * recebia oferta de upgrade com uma `denied` vencida havia 21 dias. O
 * ADR-0010 já listava `denied`/`protested`/`juridical` como inadimplência dura;
 * o código nunca tinha implementado. (`protested` e `juridical` não aparecem
 * no último ano, mas a API os documenta.)
 */
export const STATUS_EM_ABERTO = ["unpaid", "denied", "protested", "juridical"] as const;
const EM_ABERTO = new Set<string>(STATUS_EM_ABERTO);

/** O que o freio e a tendência precisam ler: em aberto + renegociadas. */
export const STATUS_PARA_O_FREIO = [...STATUS_EM_ABERTO, "negotiated"];

export interface CobrancaParaFreio {
  status: string | null;
  dueDate: Date | null;
  emissionDate: Date | null;
  valor: Money;
}

/**
 * O cliente está devendo, ou acabou de renegociar?
 *
 * ⚠ Não é um sinal de venda: é o que SUSPENDE os sinais de venda. Oferecer o
 * plano Bianual a quem está com a cobrança vencida é a conversa errada — e,
 * pelo desenho anterior, bastava o cliente completar 11 meses para receber a
 * oferta, devendo ou não. Medido em 2026-09-18: 49 clientes elegíveis com
 * cobrança vencida entre 15 e 105 dias, 83 que renegociaram em 90 dias.
 *
 * O atraso tem teto (`diasDeAtrasoMax`) de propósito: dívida de dois anos é
 * outra conversa, provavelmente já com o jurídico, e não deve travar para
 * sempre um cliente que segue pagando o contrato atual.
 */
export function situacaoFinanceira(p: {
  cobrancas: CobrancaParaFreio[];
  hoje: Date;
  diasDeAtrasoMin: number;
  diasDeAtrasoMax: number;
  diasDeRenegociacao: number;
}): {
  freiar: boolean;
  vencidas: number;
  valorVencido: Money | null;
  maiorAtrasoDias: number;
  renegociou: boolean;
  motivo: string | null;
} {
  const dia = 86_400_000;
  let vencidas = 0;
  let valorVencido: Money | null = null;
  let maiorAtrasoDias = 0;
  let renegociou = false;

  for (const c of p.cobrancas) {
    if (c.status && EM_ABERTO.has(c.status) && c.dueDate) {
      const atraso = Math.floor((p.hoje.getTime() - c.dueDate.getTime()) / dia);
      if (atraso >= p.diasDeAtrasoMin && atraso <= p.diasDeAtrasoMax) {
        vencidas++;
        valorVencido = valorVencido ? valorVencido.plus(c.valor) : c.valor;
        maiorAtrasoDias = Math.max(maiorAtrasoDias, atraso);
      }
    }
    if (c.status === "negotiated") {
      const ref = c.dueDate ?? c.emissionDate;
      if (ref && (p.hoje.getTime() - ref.getTime()) / dia <= p.diasDeRenegociacao) renegociou = true;
    }
  }

  const partes: string[] = [];
  if (vencidas) partes.push(`${vencidas} cobrança(s) vencida(s), a mais antiga há ${maiorAtrasoDias} dias`);
  if (renegociou) partes.push(`renegociou nos últimos ${p.diasDeRenegociacao} dias`);

  return {
    freiar: vencidas > 0 || renegociou,
    vencidas,
    valorVencido,
    maiorAtrasoDias,
    renegociou,
    motivo: partes.length ? partes.join("; ") : null,
  };
}

/**
 * Houve cobrança renegociada desde `desde`? A régua de receita tira a
 * renegociada (para não contar em dobro), e o que sobra parece queda — então
 * uma queda de receita nesse período é AMBÍGUA, não afirmável.
 *
 * ⚠ Uma função para as duas leituras. A ficha e a fila tinham cada uma a sua
 * cópia, e divergiam no que faziam com ela: a ficha marcava AMBÍGUO qualquer
 * renegociação, mesmo sem queda nenhuma; a fila descartava o cliente.
 */
export function renegociouNoPeriodo(p: { cobrancas: CobrancaParaFreio[]; desde: Date }): boolean {
  return p.cobrancas.some((c) => {
    const ref = c.dueDate ?? c.emissionDate;
    return c.status === "negotiated" && !!ref && ref >= p.desde;
  });
}

// ---------------------------------------------------------------------------
// Base elegível — o gate do Radar, para a ficha dizer o mesmo
// ---------------------------------------------------------------------------

export type ForaDaBase = "INATIVO_NO_CONEXA" | "BLOQUEADO_NO_CONEXA" | "SEM_CONTRATO_VIGENTE";

/**
 * O cliente está fora da base que o Radar avalia — para ESTA família?
 *
 * O Radar avalia quem está ativo, não bloqueado e com contrato vigente; de
 * quem perdeu o contrato, avalia só a MUDANÇA DE CONTRATO. A ficha não tinha
 * esse gate, e um ex-cliente aparecia com "receita caiu 92%" — que é a
 * consequência da saída, não um sinal a mais. Medido em 2026-09-18 pelo
 * `conferir_consistencia`: as 4 divergências entre Radar e ficha eram isso.
 *
 * O freio (SAUDE_FINANCEIRA) passa sempre: não é sinal, é o que suspende sinal,
 * e saber que o ex-cliente está devendo continua sendo informação.
 */
export function foraDaBaseElegivel(p: {
  ativoNoConexa: boolean;
  bloqueadoNoConexa: boolean;
  temContratoVigente: boolean;
  familia: string;
}): ForaDaBase | null {
  if (p.familia === "SAUDE_FINANCEIRA") return null;
  if (!p.ativoNoConexa) return "INATIVO_NO_CONEXA";
  if (p.bloqueadoNoConexa) return "BLOQUEADO_NO_CONEXA";
  if (!p.temContratoVigente && p.familia !== "MUDANCA_CONTRATO") return "SEM_CONTRATO_VIGENTE";
  return null;
}
