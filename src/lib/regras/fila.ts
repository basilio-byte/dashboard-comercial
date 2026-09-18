import "server-only";
import { prisma } from "@/lib/db";
import { keyToUtcDate, todayKey, currentMonthKey, monthBounds, nowInAppTz, ultimosMesesFechados } from "@/lib/dates";
import { money } from "@/lib/money";
import { estadoDoEspelho } from "@/lib/intel/completude";
import { clientesComExcedente, concessaoDoContrato } from "@/lib/intel/horas";
import type { ResultadoContato } from "@prisma/client";
import {
  litoralReservouSala,
  marcoAtingido,
  quedaContraBase,
  quedaMesAMes,
  quedaSustentada,
  ehHoraAvulsa,
  mudancaDeContrato,
  situacaoFinanceira,
  temEvidenciaDeCota,
  usoAvulsoAlto,
  type CobrancaParaFreio,
  type ContratoParaValor,
} from "./familias";
import { carregarGatilhos, type GatilhoResolvido } from "./config";
import { FAMILIAS_DE_VENDA, lerParams, pesoPorValor } from "./catalogo";
import { carregarSegmentos } from "./segmentos";

/**
 * A FILA DE TODOS OS SINAIS — o Radar inteiro, não só o excedente de horas.
 *
 * ⚠ O motivo desta função existir, medido em produção em 2026-08-27: numa
 * amostra de 10 clientes, **6 tinham sinal ativo** — regra 4 em dois, regra 8
 * em um, queda de receita em três. As regras estavam disparando o tempo todo.
 *
 * Mas o sinal só aparecia **abrindo cliente por cliente**, e o Radar mostrava
 * apenas o excedente. Com 5.630 clientes, isso é o mesmo que não existir:
 * ninguém abre 5.630 fichas para descobrir quem procurar.
 *
 * A pergunta do dono foi "por que os gatilhos não estão ligados?" — e a resposta
 * era que estavam, e o produto escondia. Um sinal que ninguém vê não é sinal.
 *
 * ⚠ Em LOTE. Avaliar cliente a cliente daria N+1 sobre milhares de clientes e
 * obrigaria a um corte — e corte foi exatamente o defeito que fez a fila
 * anterior enxergar 200 dos 5.244.
 *
 * ⚠ **Desde 2026-09-16 o excedente entra aqui dentro.** Ele era uma fila
 * separada, e o resultado era um Radar que mostrava um gatilho e escondia
 * onze — exatamente o pedido do Diego de *"aumentar o número de oportunidades
 * levando em consideração os gatilhos existentes"*. Não faltava gatilho:
 * faltava a tela mostrar os que já existiam.
 */

export interface ItemDaFila {
  customerConexaId: number;
  nome: string | null;
  regra: string;
  nomeDaRegra: string;
  familia: string;
  oferta: string;
  /** O número concreto que sustenta o sinal. */
  evidencia: string;
  /** Para ordenar entre regras diferentes: quanto maior, mais forte. */
  peso: number;
  /**
   * ATIVO ou AMBIGUO — o MESMO estado que a ficha do cliente dá.
   *
   * ⚠ Até 2026-09-18 a fila não tinha estado: a regra 3 e a 5 eram AMBIGUO na
   * ficha e sinal comum no Radar. Medido: GH Engenharia aparecia no Radar pela
   * regra 3 enquanto a ficha dela dizia "ambíguo". O vendedor via duas
   * respostas para a mesma pergunta.
   */
  estado: "ATIVO" | "AMBIGUO";
}

export interface UltimoContato {
  contatoEm: Date;
  quem: string;
  resultado: ResultadoContato;
}

/** Um cliente e TODOS os sinais dele — a linha que o Radar desenha. */
export interface ClienteNaFila {
  customerConexaId: number;
  nome: string | null;
  sinais: ItemDaFila[];
  /** O peso do sinal mais forte — ordena a fila. */
  peso: number;
  ultimoContato: UltimoContato | null;
  /** Receita no ano, para o filtro e para a coluna. */
  receitaAno: number;
  segmentos: string[];
}

export interface FilaDeSinais {
  /** Um item por (cliente × regra). */
  itens: ItemDaFila[];
  /** Os mesmos itens agrupados por cliente, do sinal mais forte para o mais fraco. */
  clientes: ClienteNaFila[];
  analisados: number;
  /** Contagem por regra, para o placar. */
  porRegra: Record<string, number>;
  /** Regras que não puderam ser avaliadas, com o motivo. */
  bloqueadas: Array<{ regra: string; nome: string; motivo: string }>;
  /** Regras desligadas na configuração — diferente de bloqueadas. */
  desligadas: Array<{ regra: string; nome: string }>;
  /** Quantos gatilhos efetivamente rodaram. "Fila vazia" só é legível com isto. */
  avaliados: number;
  /**
   * Sinais de VENDA que dispariam e foram suspensos pelo freio de inadimplência.
   * Fica visível: um freio que some com ofertas em silêncio é indistinguível de
   * uma regra quebrada.
   */
  suspensosPeloFreio: number;
  /** Clientes SEM contrato vigente analisados para "perdeu o contrato". */
  semContratoAnalisados: number;
}

const fmtH = (v: { toFixed: (n: number) => string }) =>
  `${Number(v.toFixed(1))}h`.replace(".", ",");

export async function filaDeSinais(): Promise<FilaDeSinais> {
  const hoje = keyToUtcDate(todayKey());
  const mesAtual = currentMonthKey();
  const [espelho, gatilhos, segmentos] = await Promise.all([
    estadoDoEspelho(),
    carregarGatilhos(),
    carregarSegmentos(),
  ]);

  const bloqueadas: FilaDeSinais["bloqueadas"] = [];
  const desligadas: FilaDeSinais["desligadas"] = [];

  /**
   * Um gatilho roda? Três portões, e cada "não" tem motivo DIFERENTE.
   *
   * ⚠ Distinguir os três é o ponto. "Bloqueado por permissão", "desligado por
   * alguém" e "espelho incompleto" produzem a mesma fila vazia e pedem ações
   * opostas: levar a pergunta ao Conexa, religar na tela, ou esperar a
   * carga terminar. Um aviso genérico manda a pessoa trabalhar no lugar errado.
   */
  const roda = (g: GatilhoResolvido, exigeHoras = false): boolean => {
    if (g.bloqueio) {
      bloqueadas.push({ regra: g.codigo, nome: g.nome, motivo: g.bloqueio });
      return false;
    }
    if (!g.ativo) {
      desligadas.push({ regra: g.codigo, nome: g.nome });
      return false;
    }
    if (exigeHoras && !espelho.horasConfiavel) {
      bloqueadas.push({
        regra: g.codigo,
        nome: g.nome,
        motivo: `espelho incompleto (${espelho.barramHoras.join(", ")})`,
      });
      return false;
    }
    return true;
  };

  // A família diz de qual dado o gatilho depende. Quem depende de reserva não
  // roda com espelho de reservas incompleto — nenhuma regra dispara sobre dado
  // incompleto (ADR-0011).
  const DEPENDE_DE_HORAS = new Set(["USO_SEM_COTA", "PRIMEIRO_EVENTO", "EVENTO_EM_SEGMENTO", "EXCEDENTE"]);
  const ligados = gatilhos.todos.filter((g) =>
    roda(g, DEPENDE_DE_HORAS.has(g.familia)),
  );

  // ── Carga em lote: a base elegível inteira, em poucas consultas ──────────
  const contratos = await prisma.contract.findMany({
    where: {
      isActive: true,
      customerConexaId: { not: null },
      OR: [{ endDate: null }, { endDate: { gte: hoje } }],
    },
    select: {
      conexaId: true,
      customerConexaId: true,
      planConexaId: true,
      startDate: true,
      hourPlanQuotaRaw: true,
      amount: true,
      paymentFrequency: true,
      endDate: true,
      isActive: true,
    },
  });
  const idsClientes = [...new Set(contratos.map((c) => c.customerConexaId!))];

  // ── Mudança de contrato: os que TERMINARAM na janela ────────────────────
  //
  // ⚠ "Perdeu o contrato" olha exatamente quem saiu da base elegível — o
  // cliente sem contrato vigente não está em `porCliente`. Então esta família
  // tem população própria: quem teve contrato encerrado na janela, segue ativo
  // e não bloqueado no Conexa, e não tem outro vigente. Medido em 2026-09-18:
  // 28 dos 29 que perderam contrato em 45 dias continuam ativos no Conexa.
  const gatilhosDeContrato = ligados.filter((g) => g.familia === "MUDANCA_CONTRATO");
  const maiorJanela = Math.max(
    0,
    ...gatilhosDeContrato.map((g) => lerParams("MUDANCA_CONTRATO", g.params).params.janelaDias),
  );
  const inicioJanelaContrato = new Date(hoje);
  inicioJanelaContrato.setUTCDate(inicioJanelaContrato.getUTCDate() - maiorJanela);
  const encerrados = maiorJanela
    ? await prisma.contract.findMany({
        where: {
          customerConexaId: { not: null },
          endDate: { gt: inicioJanelaContrato, lte: hoje },
        },
        select: {
          conexaId: true,
          customerConexaId: true,
          planConexaId: true,
          amount: true,
          paymentFrequency: true,
          startDate: true,
          endDate: true,
          isActive: true,
        },
      })
    : [];
  const vigentes = new Set(idsClientes);
  const idsSemContrato = [
    ...new Set(encerrados.map((c) => c.customerConexaId!).filter((id) => !vigentes.has(id))),
  ];
  const semContratoElegiveis = idsSemContrato.length
    ? await prisma.customer.findMany({
        where: { conexaId: { in: idsSemContrato }, isActive: true, isBlocked: false },
        select: { conexaId: true, name: true },
      })
    : [];

  const [elegiveis, planos, categorias] = await Promise.all([
    prisma.customer.findMany({
      where: { conexaId: { in: idsClientes }, isActive: true, isBlocked: false },
      select: { conexaId: true, name: true },
    }),
    prisma.plan.findMany({
      select: { conexaId: true, serviceCategoryConexaId: true, horasInclusasMes: true },
    }),
    prisma.serviceCategory.findMany({ select: { conexaId: true, name: true } }),
  ]);
  const nomePor = new Map(
    [...elegiveis, ...semContratoElegiveis].map((c) => [c.conexaId, c.name] as const),
  );
  const planoPor = new Map(planos.map((p) => [p.conexaId, p]));
  const catPor = new Map(categorias.map((c) => [c.conexaId, c.name ?? ""]));
  const categoriaDo = (planConexaId: number | null) => {
    const p = planConexaId !== null ? planoPor.get(planConexaId) : undefined;
    const id = p?.serviceCategoryConexaId ?? null;
    return { id, nome: id != null ? catPor.get(id) ?? "" : "" };
  };

  const porCliente = new Map<number, typeof contratos>();
  for (const c of contratos) {
    if (!nomePor.has(c.customerConexaId!)) continue; // gate de elegibilidade
    const l = porCliente.get(c.customerConexaId!) ?? [];
    l.push(c);
    porCliente.set(c.customerConexaId!, l);
  }
  const alvos = [...porCliente.keys()];

  // Reservas: só as do mês corrente (regras 4 e 10) e a primeira de cada
  // cliente (regra 5). Duas consultas em vez de trazer 21 mil linhas.
  //
  // ⚠ COM limite superior. A consulta usava só `dataLocal >= início do mês`, e
  // todo agendamento FUTURO entrava como "horas no mês": medido em 2026-09-18,
  // os "64h no mês" de um cliente eram 16h × setembro, outubro, novembro e
  // dezembro — reservas recorrentes já marcadas. A ficha do cliente filtrava
  // certo, então Radar e ficha discordavam sobre o mesmo cliente.
  const { fromDate: inicioMes, toDateExclusive: fimMes } = monthBounds(mesAtual);

  // Janela da evidência de cota: a maior pedida entre os gatilhos que a usam.
  const mesesDeEvidencia = Math.max(
    1,
    ...ligados
      .filter((g) => g.familia === "USO_SEM_COTA" || g.familia === "EVENTO_EM_SEGMENTO")
      .map((g) => Number((g.params as { mesesDeEvidenciaDeCota?: number }).mesesDeEvidenciaDeCota ?? 3)),
  );
  const inicioEvidencia = inicioDaJanela(mesAtual, mesesDeEvidencia);
  const idsSemContratoElegiveis = semContratoElegiveis.map((c) => c.conexaId);
  const todos = [...alvos, ...idsSemContratoElegiveis];
  const umAnoAtras = new Date(hoje);
  umAnoAtras.setUTCDate(umAnoAtras.getUTCDate() - 400);

  const [reservasDoMes, abatidas, primeiras, mensais, perfis, contatos, cobrancasBrutas] = await Promise.all([
    prisma.roomBooking.findMany({
      where: {
        customerConexaId: { in: alvos },
        isActive: true,
        cancellationReason: null,
        dataLocal: { gte: inicioMes, lt: fimMes },
      },
      select: { customerConexaId: true, horas: true, status: true, saleConexaId: true },
    }),
    // A evidência de posse de cota — as reservas que o Conexa abateu.
    prisma.roomBooking.findMany({
      where: {
        customerConexaId: { in: alvos },
        isActive: true,
        cancellationReason: null,
        status: "deductedFromQuota",
        dataLocal: { gte: inicioEvidencia },
      },
      select: { customerConexaId: true, status: true, dataLocal: true },
    }),
    prisma.roomBooking.groupBy({
      by: ["customerConexaId"],
      where: { customerConexaId: { in: alvos }, isActive: true, cancellationReason: null },
      _min: { dataLocal: true },
    }),
    prisma.customerMonthlyRevenue.findMany({
      // O mês em curso entra: ele só pode DESMENTIR uma queda, nunca criar.
      where: {
        customerConexaId: { in: alvos },
        mesKey: { in: [...ultimosMesesFechados(12), mesAtual] },
      },
      select: { customerConexaId: true, mesKey: true, receita: true },
    }),
    prisma.customerProfile.findMany({
      where: { customerConexaId: { in: todos } },
      select: { customerConexaId: true, receitaAnoCorrente: true, segmentos: true },
    }),
    // ⚠ Sugestão do Diego: sem o último contato, a fila mostra o mesmo cliente
    // todo dia, inclusive para quem já ligou ontem — e o vendedor aprende a
    // ignorá-la. É assim que uma ferramenta de recomendação morre.
    prisma.contato.findMany({
      where: { customerConexaId: { in: todos } },
      orderBy: { contatoEm: "desc" },
      select: { customerConexaId: true, contatoEm: true, quem: true, resultado: true },
    }),
    // O freio e a tendência precisam das cobranças vencidas e renegociadas.
    prisma.charge.findMany({
      where: {
        customerConexaId: { in: todos },
        status: { in: ["unpaid", "negotiated"] },
        OR: [{ dueDate: { gte: umAnoAtras } }, { emissionDate: { gte: umAnoAtras } }],
      },
      select: {
        customerConexaId: true,
        status: true,
        dueDate: true,
        emissionDate: true,
        amount: true,
        currentAmount: true,
      },
    }),
  ]);

  // Só hora AVULSA conta para a regra 4 — venda com valor, fora da cota. É a
  // mesma leitura da ficha (`avaliar.ts`), com a mesma função.
  const idsDeVenda = [
    ...new Set(reservasDoMes.map((b) => b.saleConexaId).filter((x): x is number => x !== null)),
  ];
  const valorDaVenda = new Map(
    (idsDeVenda.length
      ? await prisma.sale.findMany({
          where: { conexaId: { in: idsDeVenda } },
          select: { conexaId: true, amount: true },
        })
      : []
    ).map((v) => [v.conexaId, Number(v.amount)]),
  );
  const horasAvulsasPor = new Map<number, ReturnType<typeof money>>();
  const reservasNoMesPor = new Map<number, number>();
  for (const b of reservasDoMes) {
    if (b.customerConexaId === null) continue;
    if (
      ehHoraAvulsa({
        status: b.status,
        valorDaVenda: b.saleConexaId !== null ? valorDaVenda.get(b.saleConexaId) ?? null : null,
      })
    ) {
      horasAvulsasPor.set(
        b.customerConexaId,
        (horasAvulsasPor.get(b.customerConexaId) ?? money(0)).plus(money(b.horas?.toString() ?? 0)),
      );
    }
    reservasNoMesPor.set(b.customerConexaId, (reservasNoMesPor.get(b.customerConexaId) ?? 0) + 1);
  }
  const abatidasPor = new Map<number, typeof abatidas>();
  for (const b of abatidas) {
    if (b.customerConexaId === null) continue;
    const l = abatidasPor.get(b.customerConexaId) ?? [];
    l.push(b);
    abatidasPor.set(b.customerConexaId, l);
  }
  /** Mesma função da ficha — é o que impede Radar e ficha de discordarem. */
  const evidenciaDeCota = (id: number, meses: number) =>
    temEvidenciaDeCota({ reservas: abatidasPor.get(id) ?? [], desde: inicioDaJanela(mesAtual, meses) });
  const primeiraPor = new Map(
    primeiras.filter((g) => g.customerConexaId !== null).map((g) => [g.customerConexaId!, g._min.dataLocal]),
  );
  const seriePor = new Map<number, Array<{ mesKey: string; valor: ReturnType<typeof money> }>>();
  const emCursoPor = new Map<number, ReturnType<typeof money>>();
  for (const m of mensais) {
    if (m.mesKey === mesAtual) {
      emCursoPor.set(m.customerConexaId, money(m.receita.toString()));
      continue;
    }
    const l = seriePor.get(m.customerConexaId) ?? [];
    l.push({ mesKey: m.mesKey, valor: money(m.receita.toString()) });
    seriePor.set(m.customerConexaId, l);
  }
  const perfilPor = new Map(perfis.map((p) => [p.customerConexaId, p]));

  const cobrancasPor = new Map<number, CobrancaParaFreio[]>();
  for (const c of cobrancasBrutas) {
    if (c.customerConexaId === null) continue;
    const l = cobrancasPor.get(c.customerConexaId) ?? [];
    l.push({
      status: c.status,
      dueDate: c.dueDate,
      emissionDate: c.emissionDate,
      valor: money((c.currentAmount ?? c.amount).toString()),
    });
    cobrancasPor.set(c.customerConexaId, l);
  }

  /** Mesma função da ficha. Qualquer freio ligado que acione basta. */
  const freios = ligados.filter((g) => g.familia === "SAUDE_FINANCEIRA");
  const freiado = (id: number) =>
    freios.some((g) => {
      const pf = lerParams("SAUDE_FINANCEIRA", g.params).params;
      return situacaoFinanceira({ cobrancas: cobrancasPor.get(id) ?? [], hoje, ...pf }).freiar;
    });
  const freioPor = new Map<number, boolean>();
  const estaFreiado = (id: number) => {
    if (!freioPor.has(id)) freioPor.set(id, freiado(id));
    return freioPor.get(id)!;
  };

  const renegociouDesde = (id: number, desde: Date) =>
    (cobrancasPor.get(id) ?? []).some((c) => {
      const ref = c.dueDate ?? c.emissionDate;
      return c.status === "negotiated" && !!ref && ref >= desde;
    });

  const paraValor = (c: {
    conexaId: number;
    planConexaId: number | null;
    amount: { toString(): string };
    paymentFrequency: string | null;
    startDate: Date | null;
    endDate: Date | null;
    isActive: boolean;
  }): ContratoParaValor => ({
    conexaId: c.conexaId,
    amount: money(c.amount.toString()),
    paymentFrequency: c.paymentFrequency,
    startDate: c.startDate,
    endDate: c.endDate,
    isActive: c.isActive,
    // Programa (e categoria ignorada) não é permanência — mesma leitura da ficha.
    foraDaPermanencia: segmentos.foraDaPermanencia(categoriaDo(c.planConexaId).id),
  });
  const encerradosPor = new Map<number, ContratoParaValor[]>();
  for (const c of encerrados) {
    const l = encerradosPor.get(c.customerConexaId!) ?? [];
    l.push(paraValor(c));
    encerradosPor.set(c.customerConexaId!, l);
  }
  const contatoPor = new Map<number, UltimoContato>();
  for (const c of contatos) {
    // Vêm ordenados por data desc: o primeiro de cada cliente é o mais recente.
    if (!contatoPor.has(c.customerConexaId)) {
      contatoPor.set(c.customerConexaId, {
        contatoEm: c.contatoEm,
        quem: c.quem,
        resultado: c.resultado,
      });
    }
  }

  // ── Avaliação, em memória ───────────────────────────────────────────────
  const itens: ItemDaFila[] = [];
  let suspensosPeloFreio = 0;
  const add = (
    id: number,
    g: GatilhoResolvido,
    evidencia: string,
    peso: number,
    estado: ItemDaFila["estado"] = "ATIVO",
  ) => {
    // ⚠ Oferta de VENDA para quem está devendo é a conversa errada. Os sinais
    // de saída (tendência, mudança de contrato) passam: com quem está saindo a
    // conversa acontece mesmo com dívida.
    if (FAMILIAS_DE_VENDA.has(g.familia) && estaFreiado(id)) {
      suspensosPeloFreio++;
      return;
    }
    itens.push({
      customerConexaId: id,
      nome: nomePor.get(id) ?? null,
      regra: g.codigo,
      nomeDaRegra: g.nome,
      familia: g.familia,
      oferta: g.oferta,
      evidencia,
      peso,
      estado,
    });
  };

  const porFamilia = (f: string) => ligados.filter((g) => g.familia === f);

  // Quem comprou SeaBox — só entre os que estrearam agora, que são poucos.
  const estreantes = porFamilia("PRIMEIRO_EVENTO").length
    ? [...primeiraPor.entries()].filter(([, d]) => {
        if (!d) return false;
        return porFamilia("PRIMEIRO_EVENTO").some((g) => {
          const p = lerParams("PRIMEIRO_EVENTO", g.params).params;
          return (
            d >= keyToUtcDate(p.desde) &&
            marcoAtingido({ inicio: d, meses: 0, hoje, toleranciaDias: p.toleranciaDias })
          );
        });
      }).map(([id]) => id)
    : [];
  const compraramSeaBox = new Set<number>();
  if (estreantes.length) {
    const catsSeaBox = categorias.filter((c) => segmentos.ehSeaBox(c.conexaId, c.name)).map((c) => c.conexaId);
    const produtosSeaBox = catsSeaBox.length
      ? await prisma.product.findMany({
          where: { serviceCategoryConexaId: { in: catsSeaBox } },
          select: { conexaId: true },
        })
      : [];
    if (produtosSeaBox.length) {
      const vendas = await prisma.sale.findMany({
        where: {
          customerConexaId: { in: estreantes },
          productConexaId: { in: produtosSeaBox.map((x) => x.conexaId) },
        },
        select: { customerConexaId: true },
        distinct: ["customerConexaId"],
      });
      for (const v of vendas) if (v.customerConexaId !== null) compraramSeaBox.add(v.customerConexaId);
    }
  }

  for (const [id, lista] of porCliente) {
    // ⚠ A MESMA função da ficha. A versão anterior contava um array VAZIO em
    // `hourPlanQuotaRaw` como cota — e a regra 4 sumia do Radar para um
    // cliente que a ficha dizia não ter cota.
    const temCota = lista.some(
      (c) =>
        concessaoDoContrato(c, c.planConexaId !== null ? planoPor.get(c.planConexaId) : undefined)
          .concedido !== null,
    );

    // ── MARCO_CONTRATO ────────────────────────────────────────────────────
    for (const g of porFamilia("MARCO_CONTRATO")) {
      const p = lerParams("MARCO_CONTRATO", g.params).params;
      const alvo = lista.find((c) => {
        if (!c.startDate) return false;
        if (p.segmento !== "QUALQUER") {
          const cat = categoriaDo(c.planConexaId);
          if (segmentos.de(cat.id, cat.nome) !== p.segmento) return false;
        }
        return marcoAtingido({
          inicio: c.startDate,
          meses: p.meses,
          hoje,
          toleranciaDias: p.toleranciaDias,
        });
      });
      if (alvo) add(id, g, `contrato #${alvo.conexaId}`, g.peso);
    }

    // ── USO_SEM_COTA ──────────────────────────────────────────────────────
    const horas = horasAvulsasPor.get(id) ?? money(0);
    for (const g of porFamilia("USO_SEM_COTA")) {
      const p = lerParams("USO_SEM_COTA", g.params).params;
      const comCota = temCota || evidenciaDeCota(id, p.mesesDeEvidenciaDeCota);
      if (usoAvulsoAlto({ temContratoComCota: comCota, horasNoMes: horas, limiarHoras: p.limiarHoras })) {
        add(id, g, `${fmtH(horas)} pagas como avulso no mês`, g.peso + Number(horas) * 2);
      }
    }

    // ── PRIMEIRO_EVENTO ───────────────────────────────────────────────────
    //
    // ⚠ A mesma leitura da ficha: quem já tem SeaBox (por compra ou por
    // contrato) não recebe a oferta; quem não comprou é AMBIGUO, porque pode ter
    // recebido de cortesia — e esse mapeamento não existe na API. A fila
    // oferecia SeaBox a todo estreante.
    for (const g of porFamilia("PRIMEIRO_EVENTO")) {
      const p = lerParams("PRIMEIRO_EVENTO", g.params).params;
      const primeira = primeiraPor.get(id) ?? null;
      if (
        primeira &&
        primeira >= keyToUtcDate(p.desde) &&
        marcoAtingido({ inicio: primeira, meses: 0, hoje, toleranciaDias: p.toleranciaDias })
      ) {
        const temSeaBox =
          lista.some((c) => {
            const cat = categoriaDo(c.planConexaId);
            return segmentos.ehSeaBox(cat.id, cat.nome);
          }) || compraramSeaBox.has(id);
        if (!temSeaBox) add(id, g, "estreou agora", g.peso, "AMBIGUO");
      }
    }

    // ── EVENTO_EM_SEGMENTO ────────────────────────────────────────────────
    const nRes = reservasNoMesPor.get(id) ?? 0;
    for (const g of porFamilia("EVENTO_EM_SEGMENTO")) {
      const p = lerParams("EVENTO_EM_SEGMENTO", g.params).params;
      // ⚠ O tier vem da COTA do plano, não do nome: Litoral sem cota, Batial
      // 2h, Abissal 8h — medido na Fase 0.
      const litoral = lista.some((c) => {
        const cat = categoriaDo(c.planConexaId);
        if (!segmentos.ehFiscal(cat.id, cat.nome)) return false;
        const pl = c.planConexaId !== null ? planoPor.get(c.planConexaId) : undefined;
        return pl?.horasInclusasMes == null;
      });
      if (
        litoralReservouSala({ temPlanoFiscalSemCota: litoral, reservasNoPeriodo: nRes }) &&
        nRes >= p.reservasMinimas &&
        // Quem já tem pacote não recebe oferta de pacote.
        !evidenciaDeCota(id, p.mesesDeEvidenciaDeCota)
      ) {
        add(id, g, `${nRes} reserva(s) no mês`, g.peso + nRes);
      }
    }

    // ── TENDENCIA ─────────────────────────────────────────────────────────
    const serie = (seriePor.get(id) ?? []).sort((a, b) => a.mesKey.localeCompare(b.mesKey));
    for (const g of porFamilia("TENDENCIA")) {
      const p = lerParams("TENDENCIA", g.params).params;
      // Renegociou no período: a receita mostra a troca de cobrança, não o que
      // o cliente contratou. Na ficha é AMBIGUO; na fila, simplesmente não entra.
      const olhados = p.modo === "queda_sustentada" ? p.mesesAvaliados : p.modo === "quedas_seguidas" ? p.quedasSeguidas : 1;
      if (renegociouDesde(id, inicioDaJanela(mesAtual, olhados + 1))) continue;

      if (p.modo === "queda_sustentada") {
        const r = quedaSustentada({
          serie,
          mesesAvaliados: p.mesesAvaliados,
          mesesDeBase: p.mesesDeBase,
          limiarPct: p.limiarPct,
          mesEmCurso: emCursoPor.get(id) ?? null,
          baseMinima: p.baseMinima,
        });
        if (r.disparou && r.variacaoPct !== null) {
          add(
            id,
            g,
            `${r.variacaoPct.toFixed(1).replace(".", ",")}% por ${r.avaliados.length} meses (base ${fmtBRL(r.base)}/mês)`,
            pesoPorValor(g.peso, Number(r.perdaPorMes ?? 0)),
          );
        }
        continue;
      }
      if (p.modo === "quedas_seguidas") {
        const q = quedaMesAMes({ serie, quedasSeguidas: p.quedasSeguidas, quedaMinimaPct: p.quedaMinimaPct });
        // AMBIGUO, como na ficha: avaliado sobre RECEITA, e falta definir se
        // "comprou 20h" é compra ou consumo.
        if (q.disparou) add(id, g, `${q.quedas} quedas seguidas`, g.peso + q.quedas * 5, "AMBIGUO");
        continue;
      }
      // Contra a MEDIANA dos meses anteriores, não contra o mês anterior —
      // um pico de cobrança não vira "queda" no mês seguinte.
      const pc = quedaContraBase({ serie, mesesDeBase: p.mesesDeBase, limiarPct: p.limiarPct });
      if (pc.disparou && pc.variacaoPct !== null) {
        add(
          id,
          g,
          `${pc.variacaoPct.toFixed(1).replace(".", ",")}% em ${pc.mesAvaliado} contra a mediana`,
          g.peso + Math.abs(pc.variacaoPct),
        );
      }
    }
  }

  // ── MUDANCA_CONTRATO ────────────────────────────────────────────────────
  const avaliarContrato = (id: number, contratosDoCliente: ContratoParaValor[]) => {
    for (const g of gatilhosDeContrato) {
      const p = lerParams("MUDANCA_CONTRATO", g.params).params;
      const r = mudancaDeContrato({ contratos: contratosDoCliente, hoje, janelaDias: p.janelaDias, limiarPct: p.limiarPct });
      const dia = (d: Date) => d.toISOString().slice(0, 10).split("-").reverse().join("/");
      if (p.modo === "perdeu" && r.perdeu) {
        add(
          id,
          g,
          `saiu em ${dia(r.encerrado!.endDate!)}, tinha ${fmtBRL(r.antes)}/mês`,
          pesoPorValor(g.peso, Number(r.antes ?? 0)),
        );
      }
      if (p.modo === "reduziu" && r.reduziu) {
        add(
          id,
          g,
          `${fmtBRL(r.antes)} → ${fmtBRL(r.agora)}/mês (${r.variacaoPct!.toFixed(0)}%)`,
          pesoPorValor(g.peso, Number(r.antes ?? 0) - Number(r.agora ?? 0)),
        );
      }
      if (p.modo === "concluiu" && r.concluiu) {
        add(id, g, `concluiu em ${dia(r.programaEncerrado!.endDate!)}`, g.peso);
      }
    }
  };
  if (gatilhosDeContrato.length) {
    for (const [id, lista] of porCliente) {
      avaliarContrato(id, [...lista.map(paraValor), ...(encerradosPor.get(id) ?? [])]);
    }
    for (const id of idsSemContratoElegiveis) {
      avaliarContrato(id, encerradosPor.get(id) ?? []);
    }
  }

  // ── EXCEDENTE — a fila que já existia, agora dentro desta ────────────────
  //
  // ⚠ Reaproveitada, e não reescrita: `clientesComExcedente` faz consolidação
  // por ciclo de contrato, que é a parte mais delicada do projeto inteiro (cada
  // contrato tem o SEU aniversário, e somar cotas de contratos com aniversários
  // diferentes mistura janelas). Reimplementar aqui seria ter dois lugares para
  // o mesmo bug de aritmética de ciclo.
  for (const g of porFamilia("EXCEDENTE")) {
    const p = lerParams("EXCEDENTE", g.params).params;
    try {
      const fila = await clientesComExcedente(nowInAppTz(), {
        ciclosAnalisados: p.ciclosAnalisados,
        ciclosComEstouro: p.ciclosComEstouro,
      });
      for (const i of fila.itens) {
        if (!porCliente.has(i.customerConexaId)) continue; // mesmo gate
        const s = i.horas.sinal;
        if (!s) continue;
        add(
          i.customerConexaId,
          g,
          `${fmtH(s.horasExcedentes)} por fora em ${s.ciclosComEstouro}/${s.ciclosConclusivos} ciclos`,
          g.peso + Number(s.horasExcedentes),
        );
      }
    } catch (err) {
      // ⚠ Vira bloqueio VISÍVEL, não lista vazia. A fila inteira não pode cair
      // porque um gatilho não pôde ser avaliado — os outros onze têm resposta.
      bloqueadas.push({
        regra: g.codigo,
        nome: g.nome,
        motivo: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const porRegra: Record<string, number> = {};
  for (const i of itens) porRegra[i.regra] = (porRegra[i.regra] ?? 0) + 1;

  // ── Agrupamento por cliente ─────────────────────────────────────────────
  const clientes = new Map<number, ClienteNaFila>();
  for (const i of itens) {
    const existente = clientes.get(i.customerConexaId);
    if (existente) {
      existente.sinais.push(i);
      existente.peso = Math.max(existente.peso, i.peso);
      continue;
    }
    const perfil = perfilPor.get(i.customerConexaId);
    clientes.set(i.customerConexaId, {
      customerConexaId: i.customerConexaId,
      nome: i.nome,
      sinais: [i],
      peso: i.peso,
      ultimoContato: contatoPor.get(i.customerConexaId) ?? null,
      receitaAno: perfil ? Number(perfil.receitaAnoCorrente) : 0,
      segmentos: perfil?.segmentos ?? [],
    });
  }
  // Dentro do cliente, ATIVO antes de AMBIGUO. E quem só tem sinal ambíguo
  // desce na fila: "o sistema não sabe afirmar" não pode competir de igual com
  // "o sistema afirma".
  const ordem = (a: ItemDaFila, b: ItemDaFila) =>
    (a.estado === b.estado ? 0 : a.estado === "ATIVO" ? -1 : 1) || b.peso - a.peso;
  for (const c of clientes.values()) {
    c.sinais.sort(ordem);
    const ativos = c.sinais.filter((x) => x.estado === "ATIVO");
    c.peso = ativos.length ? Math.max(...ativos.map((x) => x.peso)) : Math.max(...c.sinais.map((x) => x.peso)) * 0.7;
  }

  return {
    itens: itens.sort((a, b) => b.peso - a.peso),
    clientes: [...clientes.values()].sort((a, b) => b.peso - a.peso),
    analisados: porCliente.size,
    porRegra,
    bloqueadas,
    desligadas,
    // O freio não gera sinal — só suspende —, então não conta como "gatilho avaliado".
    avaliados: ligados.filter((g) => g.familia !== "SAUDE_FINANCEIRA").length,
    suspensosPeloFreio,
    semContratoAnalisados: idsSemContratoElegiveis.length,
  };
}

/** 1º dia do mês `meses - 1` meses antes de `mesAtual`: a janela "últimos N meses". */
function inicioDaJanela(mesAtual: string, meses: number): Date {
  const [a, m] = mesAtual.split("-").map(Number);
  return new Date(Date.UTC(a!, m! - 1 - (Math.max(1, meses) - 1), 1));
}

function fmtBRL(v: { toString(): string } | null): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v?.toString() ?? 0));
}
