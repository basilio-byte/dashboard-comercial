import { Prisma } from "@prisma/client";
import { timestampParaDataLocal } from "@/lib/dates";
import type {
  ConexaCharge,
  ConexaCompany,
  ConexaContract,
  ConexaCustomer,
  ConexaHourQuota,
  ConexaPlan,
  ConexaProduct,
  ConexaRoomBooking,
  ConexaSale,
  ConexaServiceCategory,
} from "./types";

/**
 * Tradução Conexa → banco. Tudo aqui é PURO (sem Prisma Client, sem rede) para
 * poder ser testado com fixtures da coleção Postman.
 */

/** `Date` a partir de 'yyyy-MM-dd' — coluna `@db.Date`, sem fuso. */
function dataPura(v: string | null | undefined): Date | null {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return new Date(`${s}T00:00:00.000Z`);
}

function instante(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dec(v: number | string | null | undefined): Prisma.Decimal | null {
  if (v === null || v === undefined || v === "") return null;
  return new Prisma.Decimal(String(v));
}

function decOuZero(v: number | string | null | undefined): Prisma.Decimal {
  return dec(v) ?? new Prisma.Decimal(0);
}

const json = (v: unknown): Prisma.InputJsonValue => (v ?? {}) as Prisma.InputJsonValue;

/**
 * Horas mensais inclusas de um plano.
 *
 * `null` quando o plano **não tem cota** — que é o caso do Endereço Fiscal
 * Litoral e é a chave da regra 10. Isso é diferente de zero, e a distinção não
 * pode se perder: "sem cota" é uma característica do produto; "zero horas" seria
 * uma cota vazia.
 *
 * Só soma cotas mensais. Cota diária existe no Conexa e tem outro ciclo —
 * misturar as duas daria um número sem significado.
 */
export function horasInclusasMensais(
  quotas: ConexaHourQuota[] | null | undefined,
): Prisma.Decimal | null {
  if (!Array.isArray(quotas) || quotas.length === 0) return null;
  const mensais = quotas.filter((q) => (q.validityType ?? "Monthly") === "Monthly");
  if (mensais.length === 0) return null;
  return mensais.reduce((acc, q) => acc.plus(new Prisma.Decimal(String(q.quantity ?? 0))), new Prisma.Decimal(0));
}

export function mapCompany(c: ConexaCompany) {
  const id = c.companyId ?? c.id;
  if (!id) return null;
  return { conexaId: id, name: c.name ?? null, raw: json(c) };
}

export function mapServiceCategory(c: ConexaServiceCategory) {
  const id = c.serviceCategoryId ?? c.id;
  if (!id) return null;
  return { conexaId: id, name: c.name ?? null, raw: json(c) };
}

export function mapPlan(p: ConexaPlan) {
  if (!p.planId) return null;
  return {
    conexaId: p.planId,
    companyConexaId: p.companyId ?? null,
    name: p.name ?? null,
    serviceCategoryConexaId: p.serviceCategoryId ?? null,
    isActive: p.isActive ?? true,
    horasInclusasMes: horasInclusasMensais(p.hourQuotas),
    hourQuotasRaw: p.hourQuotas ? json(p.hourQuotas) : Prisma.DbNull,
    raw: json(p),
  };
}

export function mapProduct(p: ConexaProduct) {
  if (!p.productId) return null;
  return {
    conexaId: p.productId,
    companyConexaId: p.companyId ?? null,
    name: p.name ?? null,
    serviceCategoryConexaId: p.serviceCategoryId ?? null,
    price: dec(p.price),
    isActive: p.active ?? true,
    raw: json(p),
  };
}

export function mapCustomer(c: ConexaCustomer) {
  if (!c.customerId) return null;
  return {
    conexaId: c.customerId,
    companyConexaId: c.companyId ?? null,
    name: c.name ?? null,
    tradeName: c.tradeName ?? null,
    document: c.juridicalPerson?.cnpj ?? c.naturalPerson?.cpf ?? null,
    isJuridicalPerson: c.isJuridicalPerson ?? false,
    isActive: c.isActive ?? true,
    isBlocked: c.isBlocked ?? false,
    city: c.address?.city ?? null,
    state: c.address?.state?.abbreviation ?? null,
    createdAtConexa: instante(c.createdAt),
    raw: json(c),
  };
}

export function mapContract(c: ConexaContract) {
  if (!c.contractId) return null;
  return {
    conexaId: c.contractId,
    customerConexaId: c.customerId ?? null,
    planConexaId: c.planId ?? null,
    companyConexaId: c.companyId ?? null,
    costCenterConexaId: c.costCenterId ?? null,
    sellerId: c.sellerId ?? null,
    amount: decOuZero(c.amount),
    paymentFrequency: c.paymentFrequency ?? null,
    startDate: dataPura(c.startDate),
    endDate: dataPura(c.endDate),
    isActive: c.isActive ?? true,
    dueDay: c.dueDay ?? null,
    fidelityDate: dataPura(c.fidelityDate),
    contractSummary: c.contractSummary ?? null,
    hourPlanQuotaRaw: c.hourPlanQuota ? json(c.hourPlanQuota) : Prisma.DbNull,
    createdAtConexa: instante(c.createdAt),
    updatedAtConexa: instante(c.updatedAt),
    raw: json(c),
  };
}

export function mapSale(s: ConexaSale) {
  if (!s.saleId) return null;
  return {
    conexaId: s.saleId,
    customerConexaId: s.customerId ?? null,
    productConexaId: s.productId ?? s.product?.id ?? null,
    contractConexaId: s.contractId ?? null,
    recurringSaleId: s.recurringSaleId ?? null,
    sellerId: s.sellerId ?? null,
    amount: decOuZero(s.amount),
    originalAmount: dec(s.originalAmount),
    discountValue: dec(s.discountValue),
    quantity: dec(s.quantity),
    status: s.status ?? null,
    referenceDate: instante(s.referenceDate),
    createdAtConexa: instante(s.createdAt),
    updatedAtConexa: instante(s.updatedAt),
    raw: json(s),
  };
}

export function mapCharge(c: ConexaCharge) {
  if (!c.chargeId) return null;
  return {
    conexaId: c.chargeId,
    companyConexaId: c.companyId ?? null,
    customerConexaId: c.customerId ?? null,
    status: c.status ?? null,
    type: c.type ?? null,
    receivingMethod: c.receivingMethod ?? null,
    amount: decOuZero(c.amount),
    currentAmount: dec(c.currentAmount),
    paidAmount: dec(c.paidAmount),
    competenceDate: dataPura(c.competenceDate),
    dueDate: dataPura(c.dueDate),
    paymentDate: dataPura(c.paymentDate),
    cancelDate: dataPura(c.cancelDate),
    // A emissão é o `createdAt` no relógio de parede da empresa: cobrança criada
    // 30/06 às 22h é de JUNHO. Materializada como Date para usar índice.
    emissionDate: timestampParaDataLocal(c.createdAt),
    salesIds: Array.isArray(c.salesIds) ? c.salesIds : [],
    createdAtConexa: instante(c.createdAt),
    updatedAtConexa: instante(c.updatedAt),
    raw: json(c),
  };
}

/**
 * Duração da reserva em horas.
 *
 * `null` quando falta uma das pontas ou o intervalo é inválido — nunca zero.
 * Zero significaria "reserva de duração nula", que é diferente de "não sei
 * quanto durou", e a segunda coisa não pode entrar numa soma de consumo.
 */
export function duracaoEmHoras(
  inicio: string | null | undefined,
  fim: string | null | undefined,
): Prisma.Decimal | null {
  if (!inicio || !fim) return null;
  const a = new Date(inicio).getTime();
  const b = new Date(fim).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return null;
  return new Prisma.Decimal((b - a) / 3_600_000).toDecimalPlaces(4);
}

export function mapRoomBooking(b: ConexaRoomBooking) {
  if (!b.bookingId) return null;
  return {
    conexaId: b.bookingId,
    customerConexaId: b.customerId ?? null,
    personConexaId: b.personId ?? null,
    saleConexaId: b.saleId ?? null,
    placeConexaId: b.place?.id ?? null,
    placeName: b.place?.name ?? null,
    status: b.status ?? null,
    isActive: b.isActive ?? true,
    isBilled: b.isBilled ?? false,
    completed: b.completed ?? false,
    cancellationReason: b.cancellationReason ?? null,
    recurringBookingId: b.idRecurringBooking ?? null,
    startTime: instante(b.startTime),
    finalTime: instante(b.finalTime),
    horas: duracaoEmHoras(b.startTime, b.finalTime),
    // Data-calendário do início no fuso da empresa: o corte de ciclo é no
    // relógio de parede, e reserva das 22h de 25/09 é do dia 25.
    dataLocal: timestampParaDataLocal(b.startTime),
    createdAtConexa: instante(b.createdAt),
    updatedAtConexa: instante(b.updatedAt),
    raw: json(b),
  };
}
