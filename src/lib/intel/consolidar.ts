import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { monthBounds, monthKey, nowInAppTz, ultimosMesesFechados } from "@/lib/dates";
import { money, roundMoney, variacaoPercentual } from "@/lib/money";
import { contaComoReceita, valorFaturado } from "@/lib/metrics/receita";
import { estadoDoEspelho } from "./completude";

/**
 * Consolidação do perfil comercial de cada cliente.
 *
 * Materializa o que as telas leem: receita mês a mês (com variação) e o perfil.
 * Não é cache de conveniência — a tela de lista precisa do ano inteiro de ~5.500
 * clientes, e calcular isso a cada request seria varrer as cobranças todas.
 *
 * Roda sobre o ESPELHO LOCAL, sem tocar na API: não consome rate limit.
 */

const MESES_DE_HISTORICO = 24;

export interface ResultadoConsolidacao {
  clientes: number;
  mesesCalculados: number;
  duracaoMs: number;
  /** false = o espelho está incompleto e os números saíram marcados como lacuna. */
  receitaConfiavel: boolean;
  incompletas: string[];
}

/**
 * Recalcula a receita mensal de todos os clientes, nos últimos N meses FECHADOS
 * mais o mês corrente.
 *
 * O mês corrente entra porque a tela do cliente o mostra — mas ele é marcado
 * como incompleto na UI e **nunca** participa do cálculo de variação usado por
 * regra de tendência. Ver `ultimosMesesFechados`.
 */
export async function consolidarReceitaMensal(
  ref: Date = nowInAppTz(),
  receitaConfiavel = true,
): Promise<number> {
  // Sem cobrança completa no espelho, o número derivado NÃO é fato — é lacuna.
  // Ver completude.ts para o incidente que motivou isto.
  const procedencia = receitaConfiavel ? "DERIVADO" : "INDISPONIVEL";
  const fechados = ultimosMesesFechados(MESES_DE_HISTORICO, ref);
  const meses = [...fechados, monthKey(ref)]; // corrente por último

  // Uma passada por mês: agrega no banco e traz só o resumo por cliente.
  // Somar cobrança a cobrança em JS custaria carregar centenas de milhares de
  // linhas; a régua de exclusão cabe no WHERE, então o Postgres faz o filtro.
  const acumulado = new Map<number, Map<string, { receita: Prisma.Decimal; cobrancas: number }>>();

  for (const mes of meses) {
    const { fromDate, toDateExclusive } = monthBounds(mes);
    const linhas = await prisma.charge.findMany({
      where: {
        emissionDate: { gte: fromDate, lt: toDateExclusive },
        customerConexaId: { not: null },
        // Régua do ADR-0006: cancelada e negociada ficam fora da receita.
        cancelDate: null,
        status: { notIn: ["cancelled", "canceled", "billedCancelled", "negotiated"] },
      },
      select: { customerConexaId: true, amount: true, currentAmount: true, status: true, cancelDate: true },
    });

    for (const l of linhas) {
      // Segunda barreira: a mesma régua, agora em código. O WHERE e o predicado
      // têm de concordar — se um dia divergirem, é aqui que se percebe.
      if (!contaComoReceita(l as never)) continue;
      const id = l.customerConexaId!;
      if (!acumulado.has(id)) acumulado.set(id, new Map());
      const porMes = acumulado.get(id)!;
      const atual = porMes.get(mes) ?? { receita: new Prisma.Decimal(0), cobrancas: 0 };
      const v = valorFaturado(l as never);
      porMes.set(mes, {
        receita: atual.receita.plus(new Prisma.Decimal(v.toFixed(2))),
        cobrancas: atual.cobrancas + 1,
      });
    }
  }

  // Grava, calculando a variação contra o mês imediatamente anterior da série.
  const ops: Prisma.PrismaPromise<unknown>[] = [];
  for (const [customerConexaId, porMes] of acumulado) {
    let anterior: Prisma.Decimal | null = null;
    for (const mes of meses) {
      const v = porMes.get(mes) ?? { receita: new Prisma.Decimal(0), cobrancas: 0 };
      const variacao =
        anterior === null
          ? null
          : variacaoPercentual(money(v.receita.toFixed(2)), money(anterior.toFixed(2)));
      ops.push(
        prisma.customerMonthlyRevenue.upsert({
          where: { customerConexaId_mesKey: { customerConexaId, mesKey: mes } },
          create: {
            customerConexaId,
            mesKey: mes,
            receita: v.receita,
            cobrancas: v.cobrancas,
            variacaoPct: variacao === null ? null : new Prisma.Decimal(variacao.toFixed(4)),
            procedencia,
          },
          update: {
            receita: v.receita,
            cobrancas: v.cobrancas,
            variacaoPct: variacao === null ? null : new Prisma.Decimal(variacao.toFixed(4)),
            procedencia,
            calculadoEm: new Date(),
          },
        }),
      );
      anterior = v.receita;
    }
  }

  // ⚠ APAGA a janela antes de regravar.
  //
  // Sem isto a consolidação é MONOTÔNICA: só escreve para clientes presentes em
  // `acumulado`, e quem sai (porque a única cobrança do mês foi cancelada) fica
  // com a linha antiga para sempre. O cliente seguia no Top 5 e no total do ano
  // com receita que não existe mais — e a reconciliação NÃO pega, porque ela
  // confere espelho × Conexa e o espelho está certo; errado é o derivado.
  await prisma.customerMonthlyRevenue.deleteMany({ where: { mesKey: { in: meses } } });

  // Em lotes: uma transação com dezenas de milhares de upserts estoura o tempo.
  for (let i = 0; i < ops.length; i += 500) {
    await prisma.$transaction(ops.slice(i, i + 500));
  }

  return acumulado.size;
}

/**
 * Recalcula o perfil consolidado de cada cliente: receita do ano, dos 12 meses,
 * segmentos, horas inclusas e a âncora dos marcos de contrato.
 */
export async function consolidarPerfis(
  ref: Date = nowInAppTz(),
  receitaConfiavel = true,
): Promise<number> {
  const procedencia = receitaConfiavel ? "DERIVADO" : "INDISPONIVEL";
  const anoCorrente = ref.getFullYear();
  const doze = ultimosMesesFechados(12, ref);

  const clientes = await prisma.customer.findMany({
    select: { conexaId: true },
  });

  // Restrita à janela: ler a tabela inteira traria meses fora do horizonte e
  // somaria receita de períodos que a consolidação nem recalcula.
  const janela = [...ultimosMesesFechados(MESES_DE_HISTORICO, ref), monthKey(ref)];
  const mensais = await prisma.customerMonthlyRevenue.findMany({
    where: { mesKey: { in: janela } },
    select: { customerConexaId: true, mesKey: true, receita: true },
  });
  const porCliente = new Map<number, Map<string, Prisma.Decimal>>();
  for (const m of mensais) {
    if (!porCliente.has(m.customerConexaId)) porCliente.set(m.customerConexaId, new Map());
    porCliente.get(m.customerConexaId)!.set(m.mesKey, m.receita);
  }

  // Contratos ativos + plano, para segmento, horas inclusas e âncora.
  const contratos = await prisma.contract.findMany({
    where: { isActive: true },
    select: { customerConexaId: true, planConexaId: true, startDate: true },
  });
  const planos = await prisma.plan.findMany({
    select: { conexaId: true, serviceCategoryConexaId: true, horasInclusasMes: true },
  });
  const categorias = await prisma.serviceCategory.findMany({
    select: { conexaId: true, name: true },
  });
  const nomeCategoria = new Map(categorias.map((c) => [c.conexaId, c.name ?? `categoria ${c.conexaId}`]));
  const planoPorId = new Map(planos.map((p) => [p.conexaId, p]));

  const porClienteContratos = new Map<
    number,
    { segmentos: Set<string>; horas: Prisma.Decimal | null; temSemCota: boolean; desde: Date | null; n: number }
  >();
  for (const c of contratos) {
    if (c.customerConexaId === null) continue;
    const atual =
      porClienteContratos.get(c.customerConexaId) ??
      { segmentos: new Set<string>(), horas: null, temSemCota: false, desde: null, n: 0 };
    atual.n++;

    const plano = c.planConexaId !== null ? planoPorId.get(c.planConexaId) : undefined;
    if (plano?.serviceCategoryConexaId != null) {
      // Segmento vem de contrato → plano → categoria de serviço. NUNCA de
      // substring do nome do produto: o catálogo real tem "Endereço Fiscal de
      // Comércio" e "Endereço Fiscal De Comercio" para a mesma coisa.
      atual.segmentos.add(nomeCategoria.get(plano.serviceCategoryConexaId) ?? `categoria ${plano.serviceCategoryConexaId}`);
    }
    if (plano?.horasInclusasMes != null) {
      atual.horas = (atual.horas ?? new Prisma.Decimal(0)).plus(plano.horasInclusasMes);
    } else if (plano) {
      // Plano existe e NÃO tem cota — é o caso do Endereço Fiscal Litoral, e é
      // informação, não ausência de dado. Ver ADR-0005 e a regra 10.
      atual.temSemCota = true;
    }
    if (c.startDate && (atual.desde === null || c.startDate < atual.desde)) atual.desde = c.startDate;

    porClienteContratos.set(c.customerConexaId, atual);
  }

  const ops: Prisma.PrismaPromise<unknown>[] = [];
  for (const { conexaId } of clientes) {
    const meses = porCliente.get(conexaId) ?? new Map<string, Prisma.Decimal>();

    let ano = new Prisma.Decimal(0);
    let doze12 = new Prisma.Decimal(0);
    let ultimoMes: string | null = null;
    for (const [mesKey, receita] of meses) {
      if (mesKey.startsWith(String(anoCorrente))) ano = ano.plus(receita);
      if (doze.includes(mesKey)) doze12 = doze12.plus(receita);
      if (!receita.isZero() && (ultimoMes === null || mesKey > ultimoMes)) ultimoMes = mesKey;
    }

    const ct = porClienteContratos.get(conexaId);
    ops.push(
      prisma.customerProfile.upsert({
        where: { customerConexaId: conexaId },
        create: {
          customerConexaId: conexaId,
          receitaAnoCorrente: ano,
          receita12Meses: doze12,
          ultimoMesComReceita: ultimoMes,
          segmentos: ct ? [...ct.segmentos] : [],
          horasInclusasMes: ct?.horas ?? null,
          temContratoAtivo: Boolean(ct?.n),
          contratosAtivos: ct?.n ?? 0,
          contratoDesde: ct?.desde ?? null,
          procedencia,
        },
        update: {
          receitaAnoCorrente: ano,
          receita12Meses: doze12,
          ultimoMesComReceita: ultimoMes,
          segmentos: ct ? [...ct.segmentos] : [],
          horasInclusasMes: ct?.horas ?? null,
          temContratoAtivo: Boolean(ct?.n),
          contratosAtivos: ct?.n ?? 0,
          contratoDesde: ct?.desde ?? null,
          procedencia,
          calculadoEm: new Date(),
        },
      }),
    );
  }

  for (let i = 0; i < ops.length; i += 500) {
    await prisma.$transaction(ops.slice(i, i + 500));
  }
  return clientes.length;
}

/** Consolidação completa. Não toca na API — roda só sobre o espelho. */
export async function consolidarTudo(ref: Date = nowInAppTz()): Promise<ResultadoConsolidacao> {
  const t0 = Date.now();
  const run = await prisma.syncRun.create({
    data: { mode: "intelligence", ownerId: "intel", heartbeatAt: new Date() },
  });
  try {
    const espelho = await estadoDoEspelho();
    const mesesCalculados = await consolidarReceitaMensal(ref, espelho.receitaConfiavel);
    const clientes = await consolidarPerfis(ref, espelho.receitaConfiavel);
    const duracaoMs = Date.now() - t0;
    await prisma.syncRun.update({
      where: { id: run.id },
      data: {
        status: "SUCCESS",
        finishedAt: new Date(),
        recordsWrote: clientes,
        detail: { duracaoMs, receitaConfiavel: espelho.receitaConfiavel, incompletas: espelho.incompletas },
      },
    });
    return { clientes, mesesCalculados, duracaoMs, receitaConfiavel: espelho.receitaConfiavel, incompletas: espelho.incompletas };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await prisma.syncRun.update({
      where: { id: run.id },
      data: { status: "FAILED", finishedAt: new Date(), error: msg },
    });
    throw err;
  }
}

export { roundMoney };
