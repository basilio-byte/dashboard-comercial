import "server-only";
import { prisma } from "@/lib/db";
import { keyToUtcDate, nowInAppTz, todayKey } from "@/lib/dates";
import { estadoDoEspelho } from "./completude";
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
  // ⚠ NORMALIZA para data-calendário em meia-noite UTC.
  //
  // `cicloVigente` lê `getUTCDate()/getUTCMonth()`, mas `nowInAppTz()` é um
  // valor que a convenção do projeto lê com getters LOCAIS. Num processo com
  // TZ=UTC-3, o instante 2026-09-26T00:30Z (= 25/09 21h30 em Fortaleza) tem
  // `getUTCDate() === 26`: o ciclo virava 3h antes da hora, todo dia entre 21h
  // e meia-noite. Em produção o Alpine cai em UTC e acertava por sorte; na
  // máquina de desenvolvimento já estava errado.
  const refDia = keyToUtcDate(todayKey());

  const contratos = await prisma.contract.findMany({
    where: {
      customerConexaId,
      isActive: true,
      planConexaId: { not: null },
      // `isActive` vem espelhado do ERP e herda o atraso do operador em baixar
      // a flag. `endDate` é o fato — contrato encerrado não ancora ciclo nem
      // contribui cota.
      OR: [{ endDate: null }, { endDate: { gte: refDia } }],
    },
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

  const planos = await prisma.plan.findMany({
    where: { conexaId: { in: contratos.map((c) => c.planConexaId!).filter(Boolean) } },
  });
  const planoPorId = new Map(planos.map((p) => [p.conexaId, p]));

  // A âncora tem de ser um contrato que TEM cota. O filtro anterior era só
  // "tem plano", então um Endereço Fiscal Litoral antigo (cota nula) ancorava
  // o ciclo de uma cota que pertence a outro contrato, posterior.
  const comCota = contratos.filter((c) => {
    const p = c.planConexaId !== null ? planoPorId.get(c.planConexaId) : undefined;
    return p?.horasInclusasMes != null;
  });
  const ancora = comCota[0] ?? contratos[0]!;

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

  const vigente = cicloVigente(inicio, refDia);
  const fechadosCiclos = ciclosFechados(inicio, refDia, CICLOS_ANALISADOS);
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
export interface FilaExcedente {
  itens: Array<{ customerConexaId: number; nome: string | null; horas: HorasDoCliente }>;
  /** true = o corte foi atingido e a fila está incompleta. */
  truncado: boolean;
  analisados: number;
}

export async function clientesComExcedente(
  ref: Date = nowInAppTz(),
  opts: { limite?: number } = {},
): Promise<FilaExcedente> {
  // ⚠ GATE. Esta função é a porta de entrada da fila que vira task no ClickUp,
  // e era a única do caminho sem selo de completude — a proteção existia só
  // onde um humano olha. Devolver lista vazia seria pior: vazio é
  // indistinguível de "ninguém estourou".
  const espelho = await estadoDoEspelho();
  if (!espelho.horasConfiavel) {
    throw new Error(
      `Espelho incompleto (${espelho.incompletas.join(", ")}) — a fila de excedente não pode ser ` +
        `calculada sem risco de apontar o cliente errado.`,
    );
  }

  const limite = opts.limite ?? 500;
  const comCota = await prisma.contract.findMany({
    where: {
      isActive: true,
      planConexaId: { not: null },
      customerConexaId: { not: null },
      // Gate de elegibilidade no WHERE, e não depois de 4 idas ao banco por cliente.
      customer: { isActive: true, isBlocked: false },
    },
    select: { customerConexaId: true },
    distinct: ["customerConexaId"],
    // Sem `orderBy` o Postgres não garante QUAIS 500 — a fila do vendedor
    // mudaria entre execuções sem nada ter mudado no negócio.
    orderBy: { customerConexaId: "asc" },
    take: limite + 1,
  });
  const truncado = comCota.length > limite;
  const alvos = comCota.slice(0, limite);

  const saida: Array<{ customerConexaId: number; nome: string | null; horas: HorasDoCliente }> = [];
  for (const { customerConexaId } of alvos) {
    if (customerConexaId === null) continue;
    const horas = await horasDoCliente(customerConexaId, ref);
    if (!horas.sinal?.recorrente) continue;
    const cliente = await prisma.customer.findUnique({
      where: { conexaId: customerConexaId },
      select: { name: true },
    });
    saida.push({ customerConexaId, nome: cliente?.name ?? null, horas });
  }

  return {
    itens: saida.sort((a, b) =>
      Number(b.horas.sinal!.horasExcedentes.minus(a.horas.sinal!.horasExcedentes)),
    ),
    truncado,
    analisados: alvos.length,
  };
}
