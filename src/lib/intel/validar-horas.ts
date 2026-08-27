import "server-only";
import { prisma } from "@/lib/db";
import { keyToUtcDate, todayKey } from "@/lib/dates";
import { horasDoCliente, type HorasDoCliente } from "./horas";
import { estadoDoEspelho } from "./completude";

/**
 * AMOSTRA DE VALIDAÇÃO DO SALDO DE HORAS.
 *
 * O saldo é **derivado**, não lido da API: `concedido − abatido`, com o ciclo
 * ancorado na data de contratação. Derivação sem conferência é chute com cara
 * de conta, e este número decide se um cliente recebe oferta.
 *
 * Esta função monta a amostra para alguém conferir **contra a tela do Conexa**,
 * cliente por cliente. Ela não valida nada sozinha — ela torna a validação
 * possível, que é diferente.
 *
 * ⚠ Uma tentativa anterior de validar isso foi INVÁLIDA: eu consultei
 * `/room/bookings` com `bookingDateTimeFrom` em formato de data pura, a API
 * respondeu **400**, e o código leu o corpo de erro como "zero reservas". O
 * resultado — "saldo 6h, nenhuma reserva no mês" — parecia uma confirmação e
 * não era nada. Agora a leitura vem do espelho local, que é carregado por
 * janelas e conferido.
 *
 * Critério de aprovação (do ADR-0005): **100% de concordância no SINAL do
 * gatilho**. Errar 0,5h num saldo de 20h é irrelevante; o que não pode é o
 * derivado dizer "abaixo do limiar" com o Conexa dizendo "acima". Reprovar é
 * entrega válida — as regras de saldo ficam desligadas e a lacuna documentada.
 */

export interface LinhaValidacao {
  customerConexaId: number;
  nome: string | null;
  contratoConexaId: number;
  planoNome: string | null;
  /** Cota do plano, por ciclo. */
  concedido: string | null;
  /** Janela do ciclo em curso, no formato que o Conexa mostra. */
  cicloRotulo: string;
  cicloInicio: string;
  cicloFim: string;
  /** Horas que o Conexa marcou como abatidas da cota, no ciclo. */
  abatido: string;
  /** Saldo DERIVADO — é este número que precisa ser conferido. */
  saldoDerivado: string | null;
  /** Horas faturadas à parte no ciclo (excedente, quando há cota). */
  faturado: string;
  /** Reservas que não pudemos classificar — se > 0, a linha não é conclusiva. */
  naoClassificado: string;
  conclusivo: boolean;
  /**
   * ⚠ O Conexa abateu MAIS horas do que a cota que conhecemos.
   *
   * `abatido > concedido` é impossível se a concessão estiver certa. Quando
   * acontece, o problema é NOSSO — e a linha não serve para aprovar nem
   * reprovar o cálculo, igual à não conclusiva.
   */
  cotaInconsistente: boolean;
  /** De onde saiu a cota: `contrato` (a que vale) ou `plano` (o padrão). */
  origemDaCota: "contrato" | "plano" | null;
  /** Mais de um contrato com cota: a atribuição por contrato é ambígua. */
  ambiguo: boolean;
  reservasNoCiclo: number;
}

export interface AmostraValidacao {
  linhas: LinhaValidacao[];
  /** Bloqueio: sem espelho completo, a amostra não vale conferência. */
  bloqueio: string | null;
  analisados: number;
  comCota: number;
}

const fmt = (v: { toFixed: (n: number) => string } | null): string =>
  v === null ? "—" : Number(v.toFixed(2)).toString().replace(".", ",");

const dia = (d: Date) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(d);

/**
 * Monta a amostra. Escolhe clientes com contrato ativo COM cota, priorizando
 * quem teve movimento no ciclo — conferir dez linhas de saldo intacto não prova
 * nada sobre o cálculo do consumo.
 */
export async function amostraDeValidacao(limite = 20): Promise<AmostraValidacao> {
  const espelho = await estadoDoEspelho();
  if (!espelho.horasConfiavel) {
    return {
      linhas: [],
      bloqueio:
        `O espelho está incompleto (${espelho.incompletas.join(", ")}). Conferir saldo agora ` +
        `mediria a carga, não o cálculo — uma reserva que ainda não foi carregada aparece como ` +
        `hora não consumida, e o saldo sai alto de propósito errado.`,
      analisados: 0,
      comCota: 0,
    };
  }

  const refDia = keyToUtcDate(todayKey());

  // Planos COM cota — o universo que faz sentido validar.
  const planosComCota = await prisma.plan.findMany({
    where: { horasInclusasMes: { not: null } },
    select: { conexaId: true },
  });
  const idsPlanos = planosComCota.map((p) => p.conexaId);

  // Duas etapas: o espelho não tem FK entre contrato e cliente, então o gate de
  // elegibilidade não cabe num join. Ver o comentário no schema.
  const comContrato = await prisma.contract.findMany({
    where: {
      isActive: true,
      planConexaId: { in: idsPlanos },
      customerConexaId: { not: null },
      OR: [{ endDate: null }, { endDate: { gte: refDia } }],
    },
    select: { customerConexaId: true },
    distinct: ["customerConexaId"],
    orderBy: { customerConexaId: "asc" },
  });
  const contratos = await prisma.customer.findMany({
    where: {
      conexaId: { in: comContrato.map((c) => c.customerConexaId!).filter((x) => x !== null) },
      isActive: true,
      isBlocked: false,
    },
    select: { conexaId: true },
    orderBy: { conexaId: "asc" },
  });

  const linhas: LinhaValidacao[] = [];
  const semMovimento: LinhaValidacao[] = [];
  let analisados = 0;

  for (const { conexaId: customerConexaId } of contratos) {
    if (linhas.length >= limite) break;
    analisados++;

    const h: HorasDoCliente = await horasDoCliente(customerConexaId);
    const cliente = await prisma.customer.findUnique({
      where: { conexaId: customerConexaId },
      select: { name: true },
    });

    for (const c of h.contratos) {
      if (c.concedido === null || !c.cicloAtual) continue;
      const ciclo = c.cicloAtual;
      const linha: LinhaValidacao = {
        customerConexaId,
        nome: cliente?.name ?? null,
        contratoConexaId: c.contratoConexaId,
        planoNome: c.planoNome,
        concedido: fmt(c.concedido),
        cicloRotulo: ciclo.ciclo.rotulo,
        cicloInicio: dia(ciclo.ciclo.inicio),
        cicloFim: dia(new Date(ciclo.ciclo.fimExclusivo.getTime() - 86_400_000)),
        abatido: fmt(ciclo.abatido),
        saldoDerivado: ciclo.saldo === null ? null : fmt(ciclo.saldo),
        faturado: fmt(ciclo.faturado),
        naoClassificado: fmt(ciclo.naoFaturado.plus(ciclo.horasDesconhecidas)),
        conclusivo: ciclo.conclusivo,
        cotaInconsistente: ciclo.cotaInconsistente,
        origemDaCota: c.origemDaCota,
        ambiguo: h.atribuicaoAmbigua,
        reservasNoCiclo: ciclo.reservas,
      };
      // Prioriza quem teve movimento: saldo intacto não exercita o cálculo.
      if (ciclo.reservas > 0) linhas.push(linha);
      else semMovimento.push(linha);
    }
  }

  // Completa a amostra com linhas sem movimento, se faltou.
  while (linhas.length < limite && semMovimento.length) linhas.push(semMovimento.shift()!);

  return { linhas, bloqueio: null, analisados, comCota: contratos.length };
}

/**
 * DE ONDE A COTA VEM, cru — para os casos em que ela não fecha.
 *
 * ⚠ Construído em vez de sair implementando `recurringSales` por hipótese.
 *
 * A pergunta aberta é por que o Conexa abateu MAIS horas do que a cota que
 * conhecemos, em 4 de 20 linhas da amostra. Havia três explicações plausíveis, e
 * a documentação da API derrubou a que eu ia perseguir:
 *
 * 1. pacote de horas comprado — mas `/products` **não declara horas** em campo
 *    nenhum (só `name`, `price`, `categoryId`), então nem a API sabe quantas
 *    horas um "Pacote de horas - 2h Mensais" concede;
 * 2. `plan.hourQuotas` com `validityType` que NÃO é `Monthly` — e o nosso
 *    conversor descarta essas linhas em silêncio. Um plano com
 *    `[Monthly 2h, Weekly 1h]` vira 2h aqui e ~6h no ERP;
 * 3. `contract.hourPlanQuota` divergindo do plano.
 *
 * As três são distinguíveis com o JSON que **já está no espelho**, sem gastar
 * uma requisição. Então: medir primeiro.
 */
export interface CotaBruta {
  origem: "plano" | "contrato";
  nome: string | null;
  quantity: number | null;
  validityType: string | null;
  spaceId: number | null;
  groupId: number | null;
  /** `false` = o nosso conversor DESCARTOU esta linha ao derivar a cota. */
  contabilizada: boolean;
}

function lerCotas(raw: unknown, origem: "plano" | "contrato"): CotaBruta[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((q) => {
    const o = (q ?? {}) as Record<string, unknown>;
    const validityType = typeof o.validityType === "string" ? o.validityType : null;
    const quantity = typeof o.quantity === "number" ? o.quantity : null;
    return {
      origem,
      nome: typeof o.name === "string" ? o.name : null,
      quantity,
      validityType,
      spaceId: typeof o.spaceId === "number" ? o.spaceId : null,
      groupId: typeof o.groupId === "number" ? o.groupId : null,
      // Espelha exatamente o filtro de `horasInclusasMensais`.
      contabilizada: (validityType ?? "Monthly") === "Monthly" && quantity !== null,
    };
  });
}

/** Cotas cruas de um cliente, por contrato — só para diagnóstico. */
export async function cotasBrutasDoCliente(customerConexaId: number): Promise<
  Array<{ contratoConexaId: number; planoNome: string | null; cotas: CotaBruta[] }>
> {
  const contratos = await prisma.contract.findMany({
    where: { customerConexaId, isActive: true },
    select: { conexaId: true, planConexaId: true, hourPlanQuotaRaw: true },
  });
  const ids = contratos.map((c) => c.planConexaId).filter((x): x is number => x !== null);
  const planos = ids.length
    ? await prisma.plan.findMany({
        where: { conexaId: { in: ids } },
        select: { conexaId: true, name: true, hourQuotasRaw: true },
      })
    : [];
  const planoPor = new Map(planos.map((p) => [p.conexaId, p]));

  return contratos.map((c) => {
    const p = c.planConexaId !== null ? planoPor.get(c.planConexaId) : undefined;
    return {
      contratoConexaId: c.conexaId,
      planoNome: p?.name ?? null,
      cotas: [...lerCotas(p?.hourQuotasRaw, "plano"), ...lerCotas(c.hourPlanQuotaRaw, "contrato")],
    };
  });
}
