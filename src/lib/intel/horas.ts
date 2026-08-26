import "server-only";
import { prisma } from "@/lib/db";
import { nowInAppTz } from "@/lib/dates";
import { money, type Money } from "@/lib/money";
import {
  avaliarExcedente,
  cicloVigente,
  ciclosFechados,
  consolidarCiclo,
  type ConsumoDoCiclo,
  type SinalExcedente,
} from "@/lib/metrics/horas";

/**
 * Leitura do consumo de horas de um cliente, ciclo a ciclo.
 *
 * A pergunta que isto responde é a que o responsável marcou como mais
 * importante: **o cliente usa mais horas do que o plano oferece?**
 */

export interface HorasDoCliente {
  /** Contrato que define a cota. `null` = cliente sem contrato com cota. */
  contratoConexaId: number | null;
  planoNome: string | null;
  /** Cota mensal do plano. `null` = plano SEM cota (Litoral), ≠ zero. */
  concedido: Money | null;
  cicloAtual: ConsumoDoCiclo | null;
  fechados: ConsumoDoCiclo[];
  sinal: SinalExcedente | null;
  /** Nenhum contrato ativo com plano — não há o que medir. */
  semContrato: boolean;
}

const CICLOS_ANALISADOS = 3;

export async function horasDoCliente(
  customerConexaId: number,
  ref: Date = nowInAppTz(),
): Promise<HorasDoCliente> {
  // O contrato que ancora o ciclo: o ativo mais antigo com plano. Se houver
  // mais de um, o mais antigo é o que define o aniversário do pacote — os
  // demais entram na cota somada, não na âncora.
  const contratos = await prisma.contract.findMany({
    where: { customerConexaId, isActive: true, planConexaId: { not: null } },
    orderBy: { startDate: "asc" },
  });

  if (!contratos.length) {
    return {
      contratoConexaId: null,
      planoNome: null,
      concedido: null,
      cicloAtual: null,
      fechados: [],
      sinal: null,
      semContrato: true,
    };
  }

  const ancora = contratos[0]!;
  const planos = await prisma.plan.findMany({
    where: { conexaId: { in: contratos.map((c) => c.planConexaId!).filter(Boolean) } },
  });
  const planoPorId = new Map(planos.map((p) => [p.conexaId, p]));

  // Cota somada dos contratos ativos. `null` quando NENHUM plano tem cota —
  // e isso é diferente de zero: é o desenho do Litoral.
  let concedido: Money | null = null;
  for (const c of contratos) {
    const p = c.planConexaId !== null ? planoPorId.get(c.planConexaId) : undefined;
    if (p?.horasInclusasMes != null) {
      concedido = (concedido ?? money(0)).plus(money(p.horasInclusasMes.toString()));
    }
  }

  const inicio = ancora.startDate;
  if (!inicio) {
    return {
      contratoConexaId: ancora.conexaId,
      planoNome: planoPorId.get(ancora.planConexaId!)?.name ?? null,
      concedido,
      cicloAtual: null,
      fechados: [],
      sinal: null,
      semContrato: false,
    };
  }

  const vigente = cicloVigente(inicio, ref);
  const fechadosCiclos = ciclosFechados(inicio, ref, CICLOS_ANALISADOS);
  const janelas = [...fechadosCiclos, ...(vigente ? [vigente] : [])];
  if (!janelas.length) {
    return {
      contratoConexaId: ancora.conexaId,
      planoNome: planoPorId.get(ancora.planConexaId!)?.name ?? null,
      concedido,
      cicloAtual: null,
      fechados: [],
      sinal: null,
      semContrato: false,
    };
  }

  // Uma consulta só, cobrindo da borda mais antiga à mais nova.
  const reservas = await prisma.roomBooking.findMany({
    where: {
      customerConexaId,
      dataLocal: {
        gte: janelas[0]!.inicio,
        lt: janelas[janelas.length - 1]!.fimExclusivo,
      },
    },
    select: {
      status: true,
      isActive: true,
      cancellationReason: true,
      horas: true,
      dataLocal: true,
    },
  });
  const paraConsumo = reservas.map((r) => ({
    status: r.status,
    isActive: r.isActive,
    cancellationReason: r.cancellationReason,
    horas: r.horas?.toString() ?? null,
    dataLocal: r.dataLocal,
  }));

  const fechados = fechadosCiclos.map((c) => consolidarCiclo(c, paraConsumo, concedido));
  const cicloAtual = vigente ? consolidarCiclo(vigente, paraConsumo, concedido) : null;

  return {
    contratoConexaId: ancora.conexaId,
    planoNome: planoPorId.get(ancora.planConexaId!)?.name ?? null,
    concedido,
    cicloAtual,
    fechados,
    // O sinal olha só os ciclos FECHADOS: o vigente está pela metade, e um
    // estouro "ainda não acontecido" não é sinal.
    sinal: fechados.length ? avaliarExcedente(fechados) : null,
    semContrato: false,
  };
}

/**
 * Clientes com excedente recorrente — a fila que interessa ao vendedor.
 *
 * ⚠ Percorre cliente a cliente porque cada um tem o **seu** ciclo, ancorado na
 * data do contrato dele. Não dá para agregar por mês-calendário em SQL: os
 * ciclos não se alinham. Custa uma consulta por cliente com contrato ativo —
 * aceitável porque roda no job, não no request.
 */
export async function clientesComExcedente(
  ref: Date = nowInAppTz(),
  opts: { limite?: number } = {},
): Promise<Array<{ customerConexaId: number; nome: string | null; horas: HorasDoCliente }>> {
  const comCota = await prisma.contract.findMany({
    where: { isActive: true, planConexaId: { not: null }, customerConexaId: { not: null } },
    select: { customerConexaId: true },
    distinct: ["customerConexaId"],
    take: opts.limite ?? 500,
  });

  const saida: Array<{ customerConexaId: number; nome: string | null; horas: HorasDoCliente }> = [];
  for (const { customerConexaId } of comCota) {
    if (customerConexaId === null) continue;
    const horas = await horasDoCliente(customerConexaId, ref);
    if (!horas.sinal?.recorrente) continue;
    const cliente = await prisma.customer.findUnique({
      where: { conexaId: customerConexaId },
      select: { name: true, isActive: true, isBlocked: true },
    });
    // Gate de elegibilidade (ADR-0010): inativo ou bloqueado nunca vira sinal.
    if (!cliente || !cliente.isActive || cliente.isBlocked) continue;
    saida.push({ customerConexaId, nome: cliente.name, horas });
  }

  return saida.sort((a, b) =>
    Number(b.horas.sinal!.horasExcedentes.minus(a.horas.sinal!.horasExcedentes)),
  );
}
