import "server-only";
import { prisma } from "@/lib/db";
import { keyToUtcDate, nowInAppTz, todayKey } from "@/lib/dates";
import { estadoDoEspelho } from "./completude";
import { money, type Money } from "@/lib/money";
import { cotaMensalDoContratoRaw } from "@/lib/conexa/mappers";
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
  /** Cota mensal do ciclo. `null` = sem cota (Litoral), que NÃO é zero. */
  concedido: Money | null;
  /** De onde a cota veio: o contrato manda, o plano é o padrão. */
  origemDaCota: OrigemDaCota;
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

/**
 * A concessão de horas do contrato, com procedência.
 *
 * ⚠ **O contrato manda, o plano é o padrão.** `plan.hourQuotas` é a cota do
 * PRODUTO; `contract.hourPlanQuota` é a cota daquele CLIENTE naquele contrato —
 * e é ela que o Conexa usa para decidir o que abate.
 *
 * A segunda estava sendo gravada (`hourPlanQuotaRaw`) e **nunca lida**. O
 * sintoma apareceu na tela de validação em produção, 2026-08-27: 4 de 20 linhas
 * com `abatido > concedido`, ou seja, saldo derivado NEGATIVO. O ERP não deduz
 * 7h de um balde de 6h — o balde é que era maior do que estávamos lendo.
 *
 * Corrigir não custou requisição nenhuma: o JSON já está no espelho desde a
 * primeira carga.
 */
export type OrigemDaCota = "contrato" | "plano" | null;

function concessaoDoContrato(
  contrato: { hourPlanQuotaRaw?: unknown },
  plano: { horasInclusasMes?: { toString(): string } | null } | undefined,
): { concedido: Money | null; origem: OrigemDaCota } {
  const doContrato = cotaMensalDoContratoRaw(contrato.hourPlanQuotaRaw);
  if (doContrato !== null) return { concedido: money(doContrato.toString()), origem: "contrato" };
  if (plano?.horasInclusasMes != null) {
    return { concedido: money(plano.horasInclusasMes.toString()), origem: "plano" };
  }
  return { concedido: null, origem: null };
}

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
    return concessaoDoContrato(c, p).concedido !== null;
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
    const { concedido, origem: origemDaCota } = concessaoDoContrato(c, plano);

    if (!c.startDate) {
      blocos.push({
        contratoConexaId: c.conexaId,
        planoNome: plano?.name ?? null,
        concedido,
        origemDaCota,
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
      origemDaCota,
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

  void ref;
  const refDia = keyToUtcDate(todayKey());

  // ── Três consultas para a base inteira, não três por cliente ──────────────
  //
  // ⚠ A versão anterior chamava `horasDoCliente` num laço, o que dá 3 consultas
  // por cliente. Para caber num request ela cortava em 200 — e o corte era por
  // `conexaId` crescente, ou seja, **os 200 clientes mais antigos**. Com 5.244
  // ativos, a tela respondia "quem procurar hoje" sobre menos de 4% da base, e
  // sempre a mesma fatia. A resposta certa podia estar fora dela para sempre.
  //
  // O gargalo era o N+1, não o volume: as reservas de todos os ciclos de todos
  // os clientes cabem numa consulta só, e a matemática é pura. Agora não há
  // corte.
  const contratos = await prisma.contract.findMany({
    where: {
      isActive: true,
      planConexaId: { not: null },
      customerConexaId: { not: null },
      // `isActive` herda o atraso do operador em baixar a flag; `endDate` é o
      // fato — contrato encerrado não ancora ciclo.
      OR: [{ endDate: null }, { endDate: { gte: refDia } }],
    },
    orderBy: [{ customerConexaId: "asc" }, { startDate: "asc" }],
  });
  if (!contratos.length) {
    return { itens: [], ambiguos: 0, truncado: false, analisados: 0 };
  }

  // Gate de elegibilidade (ADR-0010): inativo ou bloqueado nunca vira sinal.
  const elegiveis = await prisma.customer.findMany({
    where: {
      conexaId: { in: [...new Set(contratos.map((c) => c.customerConexaId!))] },
      isActive: true,
      isBlocked: false,
    },
    select: { conexaId: true, name: true },
  });
  const nomePor = new Map(elegiveis.map((c) => [c.conexaId, c.name]));

  const planos = await prisma.plan.findMany({
    where: { conexaId: { in: [...new Set(contratos.map((c) => c.planConexaId!))] } },
  });
  const planoPorId = new Map(planos.map((p) => [p.conexaId, p]));

  const porCliente = new Map<number, typeof contratos>();
  for (const c of contratos) {
    if (!nomePor.has(c.customerConexaId!)) continue; // inelegível
    const lista = porCliente.get(c.customerConexaId!) ?? [];
    lista.push(c);
    porCliente.set(c.customerConexaId!, lista);
  }

  // Uma consulta de reservas cobrindo a janela mais ampla de todos os ciclos.
  const bordas: number[] = [];
  for (const lista of porCliente.values()) {
    for (const c of lista) {
      if (!c.startDate) continue;
      const cs = ciclosFechados(c.startDate, refDia, CICLOS_ANALISADOS);
      const v = cicloVigente(c.startDate, refDia);
      if (cs.length) bordas.push(cs[0]!.inicio.getTime());
      if (v) bordas.push(v.fimExclusivo.getTime());
    }
  }
  const reservas = bordas.length
    ? await prisma.roomBooking.findMany({
        where: {
          customerConexaId: { in: [...porCliente.keys()] },
          dataLocal: { gte: new Date(Math.min(...bordas)), lt: new Date(Math.max(...bordas)) },
        },
        select: {
          customerConexaId: true,
          status: true,
          isActive: true,
          cancellationReason: true,
          horas: true,
          dataLocal: true,
        },
      })
    : [];

  const reservasPor = new Map<number, ReservaParaConsumo[]>();
  for (const r of reservas) {
    if (r.customerConexaId === null) continue;
    const lista = reservasPor.get(r.customerConexaId) ?? [];
    lista.push({
      status: r.status,
      isActive: r.isActive,
      cancellationReason: r.cancellationReason,
      horas: r.horas?.toString() ?? null,
      dataLocal: r.dataLocal,
    });
    reservasPor.set(r.customerConexaId, lista);
  }

  // ── Matemática pura, em memória ───────────────────────────────────────────
  const itens: FilaExcedente["itens"] = [];
  let ambiguos = 0;

  for (const [customerConexaId, lista] of porCliente) {
    const doCliente = reservasPor.get(customerConexaId) ?? [];

    const comCota = lista.filter((c) => {
      const p = c.planConexaId !== null ? planoPorId.get(c.planConexaId) : undefined;
      return concessaoDoContrato(c, p).concedido !== null;
    });
    // Ambíguo com mais de um contrato COM cota: a reserva não diz de qual balde
    // a hora saiu, e inventar atribuição é pior que ficar de fora.
    if (comCota.length > 1) {
      ambiguos++;
      continue;
    }

    const blocos: HorasDoContrato[] = [];
    for (const c of lista) {
      const plano = c.planConexaId !== null ? planoPorId.get(c.planConexaId) : undefined;
      const { concedido, origem: origemDaCota } = concessaoDoContrato(c, plano);
      if (!c.startDate) continue;

      const fechados = ciclosFechados(c.startDate, refDia, CICLOS_ANALISADOS).map((j) =>
        consolidarCiclo(j, doCliente, concedido),
      );
      const vigente = cicloVigente(c.startDate, refDia);
      blocos.push({
        contratoConexaId: c.conexaId,
        planoNome: plano?.name ?? null,
        concedido,
        origemDaCota,
        inicio: c.startDate,
        cicloAtual: vigente ? consolidarCiclo(vigente, doCliente, concedido) : null,
        fechados,
        // Só ciclos FECHADOS: o vigente está pela metade, e um estouro "ainda
        // não acontecido" não é sinal.
        sinal: fechados.length ? avaliarExcedente(fechados) : null,
      });
    }

    const sinal =
      blocos
        .map((b) => b.sinal)
        .filter((s): s is SinalExcedente => s !== null)
        .sort((a, b) => Number(b.horasExcedentes.minus(a.horasExcedentes)))[0] ?? null;
    if (!sinal?.recorrente) continue;

    let concedidoTotal: Money | null = null;
    for (const b of blocos) {
      if (b.concedido !== null) concedidoTotal = (concedidoTotal ?? money(0)).plus(b.concedido);
    }

    itens.push({
      customerConexaId,
      nome: nomePor.get(customerConexaId) ?? null,
      horas: {
        contratos: blocos,
        semContrato: false,
        atribuicaoAmbigua: false,
        concedidoTotal,
        sinal,
      },
    });
  }

  return {
    itens: itens.sort((a, b) =>
      Number(b.horas.sinal!.horasExcedentes.minus(a.horas.sinal!.horasExcedentes)),
    ),
    ambiguos,
    // Não existe mais corte: a fila cobre a base elegível inteira.
    truncado: false,
    analisados: porCliente.size,
  };
}
