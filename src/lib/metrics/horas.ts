import { money, type Money } from "@/lib/money";

/**
 * CICLO E CONSUMO DA COTA DE HORAS.
 *
 * Regras de negócio confirmadas pelo responsável da Seahub em 2026-08-26:
 *
 *  - o pacote vem do plano de Endereço Fiscal e vale **um ciclo ancorado na data
 *    de contratação**, não no mês-calendário. Exemplo dele: contratou 26/08 →
 *    vale até 25/09 → novo pacote em 26/09;
 *  - **sem carry-over**: as horas expiram ao fim do ciclo, usadas ou não;
 *  - **excedente é abatido e cobrado**: 5h de cota com 7h de uso = 5h abatidas
 *    da cota + 2h faturadas.
 *
 * ⚠ Ele disse "30 dias", mas o exemplo que deu descreve um **aniversário
 * mensal** (dia 26 de cada mês). As duas leituras divergem ao longo do ano:
 * 30 dias exatos a partir de 26/08 daria 25/09, depois 25/10, depois 24/11 —
 * derivando. O aniversário mantém o dia 26. Implementado o aniversário, porque
 * é o que o exemplo mostra; registrado aqui para ser fácil de trocar se a
 * medição contra o Conexa disser o contrário.
 *
 * Tudo puro e com o "hoje" injetável — data é onde bug se esconde, e um teste
 * que depende do relógio real só falha no dia errado.
 */

export interface Ciclo {
  /** Início inclusivo, meia-noite UTC da data-calendário. */
  inicio: Date;
  /** Fim EXCLUSIVO. */
  fimExclusivo: Date;
  /** Rótulo curto, ex.: "26/08–25/09". */
  rotulo: string;
}

/**
 * Soma meses a uma data preservando o dia, com **clamp** para meses curtos.
 *
 * Contratado dia 31 → em fevereiro o ciclo vira 28 (ou 29). Sem o clamp,
 * `new Date(2026, 1, 31)` escorrega para 3 de março e o ciclo inteiro desloca.
 */
export function addMesesClamp(base: Date, meses: number): Date {
  const ano = base.getUTCFullYear();
  const mes = base.getUTCMonth();
  const dia = base.getUTCDate();
  const alvo = new Date(Date.UTC(ano, mes + meses, 1));
  const ultimoDia = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth(), Math.min(dia, ultimoDia)));
}

function ddmm(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * O ciclo vigente numa data de referência, para um contrato iniciado em
 * `inicioContrato`.
 *
 * Devolve `null` quando a referência é anterior ao início do contrato — não
 * existe ciclo antes de existir contrato, e devolver o "ciclo zero" faria o
 * consumo de um cliente ser atribuído a um período em que ele não era cliente.
 */
export function cicloVigente(inicioContrato: Date, referencia: Date): Ciclo | null {
  if (referencia < inicioContrato) return null;

  // Quantos aniversários já passaram. Estimativa por diferença de meses e
  // ajuste, porque o clamp pode empurrar a borda em um mês.
  const meses =
    (referencia.getUTCFullYear() - inicioContrato.getUTCFullYear()) * 12 +
    (referencia.getUTCMonth() - inicioContrato.getUTCMonth());

  let n = meses;
  // Ajusta para trás enquanto o início calculado ficar depois da referência.
  while (n > 0 && addMesesClamp(inicioContrato, n) > referencia) n--;
  // E para frente enquanto o PRÓXIMO início ainda couber antes da referência.
  while (addMesesClamp(inicioContrato, n + 1) <= referencia) n++;

  const inicio = addMesesClamp(inicioContrato, n);
  const fimExclusivo = addMesesClamp(inicioContrato, n + 1);
  return { inicio, fimExclusivo, rotulo: `${ddmm(inicio)}–${ddmm(recuarUmDia(fimExclusivo))}` };
}

function recuarUmDia(d: Date): Date {
  return new Date(d.getTime() - 86_400_000);
}

/** Os N ciclos que terminaram antes da referência, do mais antigo ao mais novo. */
export function ciclosFechados(inicioContrato: Date, referencia: Date, n: number): Ciclo[] {
  const vigente = cicloVigente(inicioContrato, referencia);
  if (!vigente) return [];
  const ciclos: Ciclo[] = [];
  for (let i = n; i >= 1; i--) {
    const inicio = recuarCiclos(inicioContrato, vigente.inicio, i);
    if (!inicio || inicio < inicioContrato) continue;
    const fim = recuarCiclos(inicioContrato, vigente.inicio, i - 1)!;
    ciclos.push({ inicio, fimExclusivo: fim, rotulo: `${ddmm(inicio)}–${ddmm(recuarUmDia(fim))}` });
  }
  return ciclos;
}

function recuarCiclos(inicioContrato: Date, inicioVigente: Date, quantos: number): Date | null {
  const meses =
    (inicioVigente.getUTCFullYear() - inicioContrato.getUTCFullYear()) * 12 +
    (inicioVigente.getUTCMonth() - inicioContrato.getUTCMonth());
  const n = meses - quantos;
  if (n < 0) return null;
  return addMesesClamp(inicioContrato, n);
}

// ---------------------------------------------------------------------------
// Consumo e excedente
// ---------------------------------------------------------------------------

/** O mínimo que uma reserva precisa ter para entrar na conta de horas. */
export interface ReservaParaConsumo {
  status?: string | null;
  isActive?: boolean;
  cancellationReason?: string | null;
  horas?: number | string | null;
  /** Início, para saber em que ciclo cai. */
  dataLocal?: Date | null;
}

/**
 * A reserva foi abatida da cota?
 *
 * Confia no `status: "deductedFromQuota"` do próprio Conexa, em vez de tentar
 * descobrir se a sala pertence ao grupo da cota. Foi a saída que a Fase 0
 * encontrou para o problema das cotas por grupo — o ERP já respondeu a pergunta.
 */
export function abatidaDaCota(r: ReservaParaConsumo): boolean {
  if (r.isActive === false) return false;
  if (r.cancellationReason) return false;
  return r.status === "deductedFromQuota";
}

/**
 * A reserva foi FATURADA (não coberta pela cota)?
 *
 * É o rastro do excedente: quando o cliente estoura a cota, a parte que passou
 * vira cobrança. Também é o consumo inteiro de quem não tem cota nenhuma — o
 * caso do Endereço Fiscal Litoral.
 *
 * ⚠ Status medidos em produção numa amostra de 100 reservas:
 * `deductedFromQuota` (37), **`paid` (48)**, `cancelled` (14), `notBilled` (1).
 * O status de faturada é `paid` — `billed` fica aceito por segurança, mas quem
 * aparece no dado real é `paid`.
 */
export function faturada(r: ReservaParaConsumo): boolean {
  if (r.isActive === false) return false;
  if (r.cancellationReason) return false;
  return r.status === "billed" || r.status === "paid";
}

/**
 * Reserva que aconteceu mas **não foi faturada nem abatida** (`notBilled`).
 *
 * Existe no dado real e é ambígua: pode ser cobrança ainda não gerada, ou
 * cortesia. Somá-la ao consumo inflaria o uso; descartá-la em silêncio o
 * subestimaria. Então ela vira um balde PRÓPRIO, exibido à parte — a lacuna
 * fica visível em vez de virar um número com cara de fato.
 */
export function naoFaturada(r: ReservaParaConsumo): boolean {
  if (r.isActive === false) return false;
  if (r.cancellationReason) return false;
  return r.status === "notBilled";
}

export interface ConsumoDoCiclo {
  ciclo: Ciclo;
  /** Cota concedida no ciclo. `null` = plano sem cota (≠ zero). */
  concedido: Money | null;
  /** Horas abatidas da cota. */
  abatido: Money;
  /** Horas faturadas à parte — o excedente, quando há cota. */
  faturado: Money;
  /**
   * Horas de reservas `notBilled` — nem abatidas, nem faturadas. Ambíguas
   * (cobrança pendente ou cortesia), então ficam FORA de `consumido` e são
   * exibidas à parte.
   */
  naoFaturado: Money;
  /** Total consumido no ciclo (abatido + faturado). Não inclui o ambíguo. */
  consumido: Money;
  /**
   * Saldo restante. `null` quando não há cota — sem cota não existe saldo, e
   * mostrar zero sugeriria "acabou", que é outra coisa.
   */
  saldo: Money | null;
  /** Estourou a cota neste ciclo? */
  estourou: boolean;
  reservas: number;
}

/**
 * Consolida um ciclo. `concedido` nulo significa plano sem horas inclusas.
 *
 * ⚠ O excedente NÃO é `consumido − concedido` calculado por nós: é o que o
 * Conexa efetivamente faturou. Ele já aplicou a regra ("abate o que dá, cobra o
 * resto"), e recalcular por fora inventaria um número que pode divergir do que
 * o cliente pagou. Somamos o que o ERP decidiu, não o que achamos que deveria.
 */
export function consolidarCiclo(
  ciclo: Ciclo,
  reservas: ReservaParaConsumo[],
  concedido: Money | null,
): ConsumoDoCiclo {
  const doCiclo = reservas.filter(
    (r) => r.dataLocal && r.dataLocal >= ciclo.inicio && r.dataLocal < ciclo.fimExclusivo,
  );

  let abatido = money(0);
  let faturado = money(0);
  let naoFaturado = money(0);
  for (const r of doCiclo) {
    const h = money(r.horas ?? 0);
    if (abatidaDaCota(r)) abatido = abatido.plus(h);
    else if (faturada(r)) faturado = faturado.plus(h);
    else if (naoFaturada(r)) naoFaturado = naoFaturado.plus(h);
  }

  const consumido = abatido.plus(faturado);
  const saldo = concedido === null ? null : concedido.minus(abatido);

  return {
    ciclo,
    concedido,
    abatido,
    faturado,
    naoFaturado,
    consumido,
    saldo,
    // Estourar exige ter cota E ter horas faturadas por cima dela. Sem cota,
    // toda reserva é faturada e isso não é "estouro" — é o modelo do plano.
    estourou: concedido !== null && faturado.greaterThan(0),
    reservas: doCiclo.length,
  };
}

// ---------------------------------------------------------------------------
// O sinal que o responsável pediu
// ---------------------------------------------------------------------------

export interface SinalExcedente {
  /** Ciclos analisados (fechados, do mais antigo ao mais novo). */
  ciclos: ConsumoDoCiclo[];
  /** Em quantos deles o cliente estourou a cota. */
  ciclosComEstouro: number;
  /** Horas faturadas por cima da cota, somadas. */
  horasExcedentes: Money;
  /** Média de uso sobre a cota, em %. `null` quando não há cota. */
  usoMedioPct: number | null;
  /** Dispara quando estourou em pelo menos `minCiclos` dos analisados. */
  recorrente: boolean;
}

/**
 * "Usa mais horas do que o plano oferece" — o sinal que o responsável marcou
 * como o mais importante.
 *
 * É um alvo melhor que o saldo instantâneo por dois motivos: o argumento de
 * venda é concreto ("você pagou X de horas avulsas nos últimos 3 ciclos") e o
 * dado é mais robusto — o excedente deixa rastro na cobrança, então não depende
 * de acertar o saldo ao minuto.
 */
export function avaliarExcedente(
  ciclos: ConsumoDoCiclo[],
  opts: { minCiclosComEstouro?: number } = {},
): SinalExcedente {
  const minCiclos = opts.minCiclosComEstouro ?? 2;
  const comEstouro = ciclos.filter((c) => c.estourou);
  const horasExcedentes = comEstouro.reduce((acc, c) => acc.plus(c.faturado), money(0));

  const comCota = ciclos.filter((c) => c.concedido !== null && !c.concedido.isZero());
  const usoMedioPct = comCota.length
    ? Number(
        comCota
          .reduce((acc, c) => acc.plus(c.consumido.div(c.concedido!).times(100)), money(0))
          .div(comCota.length)
          .toDecimalPlaces(1),
      )
    : null;

  return {
    ciclos,
    ciclosComEstouro: comEstouro.length,
    horasExcedentes,
    usoMedioPct,
    recorrente: comEstouro.length >= minCiclos,
  };
}
