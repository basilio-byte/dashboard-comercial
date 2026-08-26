import { addMonths, format, startOfMonth } from "date-fns";
import { toZonedTime } from "date-fns-tz";

/**
 * Datas com fuso de referência (Natal/RN = America/Fortaleza, UTC-3 sem DST).
 *
 * Regra: as colunas de data ficam em `@db.Date` (data pura, sem fuso). Para
 * consultar, convertemos os limites do período para "meia-noite UTC" do
 * dia-calendário — comparação correta contra data pura.
 */
export const APP_TZ = process.env.APP_TIMEZONE || "America/Fortaleza";

/** Agora, já no fuso do app. */
export function nowInAppTz(): Date {
  return toZonedTime(new Date(), APP_TZ);
}

/**
 * Hora de um INSTANTE, no relógio de parede da empresa.
 *
 * ⚠ `Intl.DateTimeFormat` sem `timeZone` usa o fuso do PROCESSO. No container
 * o processo roda em UTC, então a última sincronização das 17h30 de Natal
 * aparecia como "sincronizado 20:30" — três horas no futuro em relação ao
 * relógio de quem estava olhando a tela. Um painel que diz a hora errada da
 * própria carga destrói a única coisa que ele promete: saber se o dado é de
 * agora.
 *
 * ⚠ Recebe INSTANTE cru do banco (`finishedAt`, `startedAt`), nunca a saída de
 * `nowInAppTz()` — aquela já vem deslocada, e formatá-la com fuso desloca de
 * novo.
 */
export function horaLocal(d: Date): string {
  return new Intl.DateTimeFormat("pt-BR", { timeStyle: "short", timeZone: APP_TZ }).format(d);
}

/** Data e hora de um INSTANTE, no relógio de parede da empresa. */
export function dataHoraLocal(d: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: APP_TZ,
  }).format(d);
}

/** 'yyyy-MM-dd' de uma data-calendário. */
export function dateKey(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

/** 'yyyy-MM' de uma data-calendário. */
export function monthKey(d: Date): string {
  return format(d, "yyyy-MM");
}

/** Hoje ('yyyy-MM-dd') no fuso do app. */
export function todayKey(): string {
  return dateKey(nowInAppTz());
}

/** Mês corrente ('yyyy-MM') no fuso do app. */
export function currentMonthKey(): string {
  return monthKey(nowInAppTz());
}

/**
 * Converte 'yyyy-MM-dd' para Date em meia-noite UTC, para comparar com `@db.Date`.
 *
 * ⚠ Não usar `toZonedTime` aqui. O projeto irmão registrou a regressão: tratar a
 * string como INSTANTE UTC e convertê-la para UTC-3 subtrai 3h de uma data que
 * nunca teve hora, e o período inteiro desliza um dia para trás.
 */
export function keyToUtcDate(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

/** Limites de um mês 'yyyy-MM': [início, próximo mês) em meia-noite UTC. */
export function monthBounds(key: string): { fromDate: Date; toDateExclusive: Date } {
  const from = keyToUtcDate(`${key}-01`);
  const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
  return { fromDate: from, toDateExclusive: to };
}

/** Limites de um ano 'yyyy': [1º de janeiro, 1º de janeiro seguinte). */
export function yearBounds(year: number): { fromDate: Date; toDateExclusive: Date } {
  return {
    fromDate: new Date(Date.UTC(year, 0, 1)),
    toDateExclusive: new Date(Date.UTC(year + 1, 0, 1)),
  };
}

/**
 * Os N meses FECHADOS mais recentes, do mais antigo para o mais novo.
 *
 * ⚠ O mês corrente fica **de fora**, sempre. Ele está incompleto por definição:
 * no dia 3, comparar 3 dias contra 31 marcaria a base inteira "em queda". É
 * critério de aceite da Fase 1, e a regra de tendência depende disso.
 *
 * `ref` é injetável para os testes não dependerem do relógio real.
 */
export function ultimosMesesFechados(n: number, ref: Date = nowInAppTz()): string[] {
  const base = startOfMonth(ref); // 1º do mês corrente
  const chaves: string[] = [];
  for (let i = n; i >= 1; i--) chaves.push(monthKey(addMonths(base, -i)));
  return chaves;
}

/** O mês fechado mais recente ('yyyy-MM'). */
export function ultimoMesFechado(ref: Date = nowInAppTz()): string {
  return ultimosMesesFechados(1, ref)[0]!;
}

/** Rótulo pt-BR de um mês 'yyyy-MM' (ex.: "mar/2026"). */
export function rotuloMes(key: string): string {
  const [ano, mes] = key.split("-");
  const nomes = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${nomes[Number(mes) - 1] ?? mes}/${ano}`;
}

/**
 * Converte um timestamp do Conexa (ISO com offset) para a DATA-CALENDÁRIO no
 * fuso da empresa, como meia-noite UTC.
 *
 * É assim que nasce a `emissionDate`: o corte tem de ser no relógio de parede da
 * empresa — cobrança criada 30/06 às 22h é de JUNHO. O projeto irmão validou
 * essa conversão contra o Conexa em 1.182/1.182 cobranças.
 */
export function timestampParaDataLocal(iso: string | Date | null | undefined): Date | null {
  if (!iso) return null;
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return null;
  return keyToUtcDate(dateKey(toZonedTime(d, APP_TZ)));
}
