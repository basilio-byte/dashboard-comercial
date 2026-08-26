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
  type ReservaParaConsumo,
  type SinalExcedente,
} from "@/lib/metrics/horas";

/**
 * Consumo de horas de um cliente, **por contrato**.
 *
 * A pergunta que isto responde é a que o responsável marcou como mais
 * importante: *o cliente usa mais horas do que o plano oferece?*
 *
 * ⚠ A consolidação é POR CONTRATO, não por cliente.
 *
 * A versão anterior escolhia um contrato "âncora", somava as cotas de todos os
 * contratos ativos e aplicava essa soma ao ciclo do âncora. Três coisas quebram
 * nesse desenho, e todas produzem sinal errado:
 *
 *  - cada contrato tem o SEU ciclo, ancorado na data de contratação DELE. Somar
 *    cotas de contratos com aniversários diferentes mistura janelas que não
 *    coincidem;
 *  - a cota somada era aplicada retroativamente a ciclos em que o segundo
 *    contrato ainda não existia — inflando a cota de um período passado e
 *    escondendo estouros reais;
 *  - o consumo do cliente inteiro era atribuído a um único balde, sem forma de
 *    saber a qual contrato a reserva pertencia.
 *
 * Agora: cada contrato com cota vira um bloco independente, e o sinal do cliente
 * é a agregação dos blocos. Quando há mais de um contrato com cota, a atribuição
 * de cada reserva é AMBÍGUA — a API não diz de qual contrato a hora saiu — e o
 * cliente é marcado como tal em vez de receber um número inventado.
 */

export interface HorasDoContrato {
  contratoConexaId: number;
  planoNome: string | null;
  /** Cota mensal do plano. `null` = plano SEM cota (Litoral), ≠ zero. */
  concedido: Money | null;
  inicio: Date;
  cicloAtual: ConsumoDoCiclo | null;
  fechados: ConsumoDoCiclo[];
  sinal: SinalExcedente | null;
}

export interface HorasDoCliente {
  contratos: HorasDoContrato[];
  /** Nenhum contrato ativo com plano — não há o que medir. */
  semContrato: boolean;
  /**
   * Mais de um contrato com cota: não dá para saber de qual balde cada reserva
   * saiu. O consumo exibido por contrato é o do cliente inteiro, então os
   * números por contrato NÃO são conclusivos.
   */
  atribuicaoAmbigua: boolean;
  /** Agregado do cliente: soma das cotas dos contratos com cota. */
  concedidoTotal: Money | null;
  /** O sinal mais forte entre os contratos, quando não ambíguo. */
  sinal: SinalExcedente | null;
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
  // e meia-noite. Em produção o Alpine cai em UTC e acertava por sorte.
  void ref;
  const refDia = keyToUtcDate(todayKey());

  const contratos = await prisma.contract.findMany({
    where: {
      customerConexaId,
      isActive: true,
      planConexaId: { not: null },
      // `isActive` vem espelhado do ERP e herda o atraso do operador em baixar
      // a flag. `endDate` é o fato — contrato encerrado não ancora ciclo.
      OR: [{ endDate: null }, { endDate: { gte: refDia } }],
    },
    orderBy: { startDate: "asc" },
  });

  const vazio: HorasDoCliente = {
    contratos: [],
    semContrato: true,
    atribuicaoAmbigua: false,
    concedidoTotal: null,
    sinal: null,
  };
  if (!contratos.length) return vazio;

  const planos = await prisma.plan.findMany({
    where: { conexaId: { in: contratos.map((c) => c.planConexaId!).filter(Boolean) } },
  });
  const planoPorId = new Map(planos.map((p) => [p.conexaId, p]));

  const comCota = contratos.filter((c) => {
    const p = c.planConexaId !== null ? planoPorId.get(c.planConexaId) : undefined;
    return p?.horasInclusasMes != null;
  });

  // Uma consulta de reservas cobrindo TODAS as janelas de todos os contratos.
  const bordas: Date[] = [];
  for (const c of contratos) {
    if (!c.startDate) continue;
    const cs = ciclosFechados(c.startDate, refDia, CICLOS_ANALISADOS);
    const v = cicloVigente(c.startDate, refDia);
    if (cs.length) bordas.push(cs[0]!.inicio);
    if (v) bordas.push(v.fimExclusivo);
  }
  const reservas = bordas.length
    ? await prisma.roomBooking.findMany({
        where: {
          customerConexaId,
          dataLocal: {
            gte: new Date(Math.min(...bordas.map((d) => d.getTime()))),
            lt: new Date(Math.max(...bordas.map((d) => d.getTime()))),
          },
        },
        select: { status: true, isActive: true, cancellationReason: true, horas: true, dataLocal: true },
      })
    : [];
  const paraConsumo: ReservaParaConsumo[] = reservas.map((r) => ({
    status: r.status,
    isActive: r.isActive,
    cancellationReason: r.cancellationReason,
    horas: r.horas?.toString() ?? null,
    dataLocal: r.dataLocal,
  }));

  const blocos: HorasDoContrato[] = [];
  for (const c of contratos) {
    const plano = c.planConexaId !== null ? planoPorId.get(c.planConexaId) : undefined;
    const concedido =
      plano?.horasInclusasMes != null ? money(plano.horasInclusasMes.toString()) : null;

    if (!c.startDate) {
      blocos.push({
        contratoConexaId: c.conexaId,
        planoNome: plano?.name ?? null,
        concedido,
        inicio: refDia,
        cicloAtual: null,
        fechados: [],
        sinal: null,
      });
      continue;
    }

    const fechadosCiclos = ciclosFechados(c.startDate, refDia, CICLOS_ANALISADOS);
    const vigente = cicloVigente(c.startDate, refDia);
    const fechados = fechadosCiclos.map((j) => consolidarCiclo(j, paraConsumo, concedido));

    blocos.push({
      contratoConexaId: c.conexaId,
      planoNome: plano?.name ?? null,
      concedido,
      inicio: c.startDate,
      cicloAtual: vigente ? consolidarCiclo(vigente, paraConsumo, concedido) : null,
      fechados,
      // O sinal olha só os ciclos FECHADOS: o vigente está pela metade, e um
      // estouro "ainda não acontecido" não é sinal.
      sinal: fechados.length ? avaliarExcedente(fechados) : null,
    });
  }

  // Ambíguo quando há mais de um contrato COM cota: a reserva não diz de qual
  // balde saiu, então cada bloco recebeu o consumo do cliente inteiro.
  const atribuicaoAmbigua = comCota.length > 1;

  let concedidoTotal: Money | null = null;
  for (const b of blocos) {
    if (b.concedido !== null) concedidoTotal = (concedidoTotal ?? money(0)).plus(b.concedido);
  }

  // O sinal do cliente é o do contrato com MAIS horas excedentes — e só existe
  // quando a atribuição não é ambígua.
  const sinal = atribuicaoAmbigua
    ? null
    : (blocos
        .map((b) => b.sinal)
        .filter((s): s is SinalExcedente => s !== null)
        .sort((a, b) => Number(b.horasExcedentes.minus(a.horasExcedentes)))[0] ?? null);

  return { contratos: blocos, semContrato: false, atribuicaoAmbigua, concedidoTotal, sinal };
}

/**
 * Clientes com excedente recorrente — a fila que interessa ao vendedor.
 *
 * ⚠ Percorre cliente a cliente porque cada contrato tem o SEU ciclo, ancorado
 * na data de contratação dele. Não dá para agregar por mês-calendário em SQL:
 * os ciclos não se alinham. Roda no job, não no request.
 */
export interface FilaExcedente {
  itens: Array<{ customerConexaId: number; nome: string | null; horas: HorasDoCliente }>;
  /** Clientes com mais de um contrato com cota — excluídos por ambiguidade. */
  ambiguos: number;
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

  // Duas etapas, porque o espelho NÃO tem chave estrangeira entre contrato e
  // cliente (ver o comentário no schema): a relação não existe para o Prisma
  // filtrar num join. Buscamos os contratos e aplicamos o gate de elegibilidade
  // com um único `findMany` de clientes — ainda antes do laço caro.
  const contratos = await prisma.contract.findMany({
    where: { isActive: true, planConexaId: { not: null }, customerConexaId: { not: null } },
    select: { customerConexaId: true },
    distinct: ["customerConexaId"],
    // Sem `orderBy` o Postgres não garante QUAIS registros vêm — a fila do
    // vendedor mudaria entre execuções sem nada ter mudado no negócio.
    orderBy: { customerConexaId: "asc" },
  });
  const ids = contratos.map((c) => c.customerConexaId!).filter((x) => x !== null);

  // Gate de elegibilidade (ADR-0010): inativo ou bloqueado nunca vira sinal.
  const elegiveis = await prisma.customer.findMany({
    where: { conexaId: { in: ids }, isActive: true, isBlocked: false },
    select: { conexaId: true, name: true },
    orderBy: { conexaId: "asc" },
  });
  const nomePor = new Map(elegiveis.map((c) => [c.conexaId, c.name]));

  const truncado = elegiveis.length > limite;
  const alvos = elegiveis.slice(0, limite).map((c) => ({ customerConexaId: c.conexaId }));

  const itens: FilaExcedente["itens"] = [];
  let ambiguos = 0;

  for (const { customerConexaId } of alvos) {
    if (customerConexaId === null) continue;
    const horas = await horasDoCliente(customerConexaId, ref);
    if (horas.atribuicaoAmbigua) {
      ambiguos++;
      continue; // não inventa atribuição: fica de fora e é contado
    }
    if (!horas.sinal?.recorrente) continue;
    itens.push({ customerConexaId, nome: nomePor.get(customerConexaId) ?? null, horas });
  }

  return {
    itens: itens.sort((a, b) =>
      Number(b.horas.sinal!.horasExcedentes.minus(a.horas.sinal!.horasExcedentes)),
    ),
    ambiguos,
    truncado,
    analisados: alvos.length,
  };
}
