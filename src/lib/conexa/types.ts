/**
 * Formas das respostas da API Conexa v2.
 *
 * Fonte da verdade: `docs/API v2 Conexa.postman_collection.json` + o que a Fase 0
 * mediu contra a API de produção. Onde os dois divergem, **vale a medição** —
 * ver `Sale.quantity`.
 *
 * Tudo é opcional de propósito: a API omite campos, e um `undefined` que o tipo
 * jurava existir vira `NaN` silencioso numa soma de dinheiro.
 */

export interface ConexaCompany {
  companyId?: number;
  id?: number;
  name?: string;
}

export interface ConexaServiceCategory {
  serviceCategoryId?: number;
  id?: number;
  name?: string;
}

/** Uma cota de horas declarada por um plano. */
export interface ConexaHourQuota {
  id?: number;
  name?: string;
  quantity?: number;
  /** Sala específica. Na Seahub, sempre null (Fase 0). */
  spaceId?: number | null;
  /** Grupo de salas. Na Seahub, sempre 2 — o único grupo existente (Fase 0). */
  groupId?: number | null;
  /** "Monthly" | "Daily" | ... — a periodicidade de renovação da cota. */
  validityType?: string;
}

export interface ConexaPlan {
  planId?: number;
  companyId?: number;
  name?: string;
  serviceCategoryId?: number;
  isActive?: boolean;
  /** `null` = plano SEM horas inclusas (é o caso do Endereço Fiscal Litoral). */
  hourQuotas?: ConexaHourQuota[] | null;
  productQuotas?: unknown;
  paymentPeriodicities?: Record<string, number>;
  fidelityMonths?: number;
}

export interface ConexaProduct {
  productId?: number;
  companyId?: number;
  name?: string;
  description?: string | null;
  serviceCategoryId?: number;
  price?: number;
  active?: boolean;
}

export interface ConexaCustomer {
  customerId?: number;
  companyId?: number;
  name?: string;
  tradeName?: string | null;
  isActive?: boolean;
  isBlocked?: boolean;
  isJuridicalPerson?: boolean;
  createdAt?: string;
  naturalPerson?: { cpf?: string } | null;
  juridicalPerson?: { cnpj?: string } | null;
  address?: { city?: string; state?: { abbreviation?: string } } | null;
  extraFields?: Array<{ id?: number; name?: string; value?: string | null }>;
}

export interface ConexaContract {
  contractId?: number;
  customerId?: number;
  planId?: number;
  companyId?: number;
  costCenterId?: number;
  sellerId?: number;
  amount?: number;
  paymentFrequency?: string;
  startDate?: string | null;
  endDate?: string | null;
  isActive?: boolean;
  dueDay?: number;
  fidelityDate?: string | null;
  contractSummary?: string | null;
  /** Cota do contrato — sobrepõe a do plano. 100% por grupo na Seahub (Fase 0). */
  hourPlanQuota?: ConexaHourQuota[] | null;
  extraFields?: Array<{ id?: number; name?: string; value?: string | null }>;
  createdAt?: string;
  updatedAt?: string;
}

export interface ConexaSale {
  saleId?: number;
  customerId?: number;
  productId?: number;
  product?: { id?: number; name?: string; companyId?: number };
  contractId?: number | null;
  recurringSaleId?: number | null;
  sellerId?: number;
  amount?: number;
  originalAmount?: number;
  discountValue?: number;
  /**
   * ⚠ A coleção tipa como `integer` e descreve como "quantidade de itens".
   * **A documentação está errada:** a Fase 0 mediu 20/20 pares (reserva, venda)
   * em que este campo é a DURAÇÃO EM HORAS, com valor fracionário.
   */
  quantity?: number;
  status?: string;
  referenceDate?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ConexaCharge {
  chargeId?: number;
  companyId?: number;
  customerId?: number;
  status?: string;
  type?: string;
  receivingMethod?: string;
  amount?: number;
  /** COM juros/multa. É o que a tela do Conexa soma — usar este, não `amount`. */
  currentAmount?: number | null;
  paidAmount?: number | null;
  competenceDate?: string | null;
  dueDate?: string | null;
  paymentDate?: string | null;
  cancelDate?: string | null;
  salesIds?: number[];
  createdAt?: string;
  updatedAt?: string;
}

export interface ConexaRoomBooking {
  bookingId?: number;
  customerId?: number;
  personId?: number;
  saleId?: number | null;
  place?: { id?: number; name?: string } | null;
  /**
   * ⚠ Valor central para o cálculo de horas: `deductedFromQuota` marca a
   * reserva que o Conexa abateu da cota do cliente.
   */
  status?: string;
  isActive?: boolean;
  isBilled?: boolean;
  completed?: boolean;
  cancellationReason?: string | null;
  idRecurringBooking?: number | null;
  /** ⚠ `startTime`/`finalTime`, NÃO `startAt`. */
  startTime?: string;
  finalTime?: string;
  createdAt?: string;
  updatedAt?: string;
}
