import "server-only";
import { prisma } from "@/lib/db";
import { keyToUtcDate, todayKey, currentMonthKey, ultimosMesesFechados } from "@/lib/dates";
import { formatBRL, money, type Money } from "@/lib/money";
import { concessaoDoContrato, horasDoCliente, type HorasDoCliente } from "@/lib/intel/horas";
import {
  litoralReservouSala,
  marcoAtingido,
  posseDoProduto,
  primeiraReserva,
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
import { FAMILIAS_DE_VENDA, LACUNA_SALDO_PACOTE, lerParams } from "./catalogo";
import { carregarSegmentos, type MapaDeSegmentos } from "./segmentos";

/**
 * SINAIS AUTOMÁTICOS DE UM CLIENTE — a aba que o documento do Diego pede.
 *
 * §4.6: *"Sinais Automáticos: cada regra de negócio da seção 1, avaliada com os
 * dados reais do cliente (marcar como: gatilho ativo / não aplicável / dado
 * indisponível / ambíguo)"*.
 *
 * ⚠ Os quatro estados são os DELE, não meus. Em especial `AMBIGUO`, que ele
 * previu e que se encaixou em dois lugares que eu não esperava: cliente com
 * mais de um contrato com cota (a reserva não diz de qual balde a hora saiu) e
 * regra que ofertaria algo que o cliente pode já ter de cortesia, sem
 * mapeamento para confirmar.
 *
 * ⚠ **Isto NÃO dispara nada.** É a camada de avaliação, e a de disparo não
 * existe. Ver a tela por cliente — é lá que o vendedor lê e decide.
 *
 * ⚠ **Desde 2026-09-16 a lista de regras é DADO, não código.** A função varre
 * `carregarGatilhos()` e despacha por família, em vez de percorrer arrays
 * escritos aqui dentro. É o que faz o "campo editável para criar gatilhos" do
 * Diego existir: um gatilho novo aparece nesta tela sem tocar neste arquivo.
 *
 * O que continua sendo código é a FAMÍLIA — a pergunta que a regra faz. Ver
 * `catalogo.ts` para o porquê dessa fronteira.
 */

export type EstadoSinal = "ATIVO" | "NAO_APLICAVEL" | "DADO_INDISPONIVEL" | "AMBIGUO";

export interface Sinal {
  /** "1".."10", "extra", "métrica" ou o código de um gatilho criado na tela. */
  regra: string;
  nome: string;
  familia: string;
  oferta: string;
  estado: EstadoSinal;
  /** Por que este estado. É o que a tela mostra quando não está ativo. */
  motivo: string;
  /** O número concreto que sustenta o sinal, quando ele existe. */
  evidencia?: string;
  /**
   * O gatilho está DESLIGADO na configuração.
   *
   * ⚠ Não virou um quinto estado de propósito: os quatro são do documento do
   * Diego, e inventar taxonomia paralela já deu errado uma vez neste projeto.
   * Mas também não podia sumir da tela — "não aplicável" e "alguém desligou"
   * parecem iguais e são opostos quando se investiga por que um cliente não
   * apareceu na fila. Então é uma marca ao lado do estado, não outro estado.
   */
  desligado?: boolean;
}

const h = (v: { toFixed: (n: number) => string }) => `${Number(v.toFixed(1))}h`.replace(".", ",");
/** Decimal em pt-BR. Ponto no lugar de vírgula é a marca de número não formatado. */
const num = (v: number) => v.toFixed(1).replace(".", ",");

// ---------------------------------------------------------------------------
// O contexto que as famílias leem
// ---------------------------------------------------------------------------

interface ContextoDoCliente {
  hoje: Date;
  mesAtual: string;
  contratos: Array<{
    conexaId: number;
    planConexaId: number | null;
    startDate: Date | null;
  }>;
  /** categoria de serviço do contrato: id e nome, para o mapa de segmentos. */
  categoriaDo(planConexaId: number | null): { id: number | null; nome: string };
  /**
   * O plano do contrato NÃO tem horas inclusas.
   *
   * ⚠ É assim que o tier do Endereço Fiscal é identificado, e não pelo nome:
   * Litoral não tem cota, Batial tem 2h, Abissal 8h — medido na Fase 0. `null`
   * em `hourQuotas` é "plano sem horas inclusas", que é diferente de zero.
   */
  planoSemCota(planConexaId: number | null): boolean;
  /**
   * Algum contrato vigente tem cota de horas — pela `concessaoDoContrato`, a
   * MESMA função que a fila usa. Antes eram duas definições, e um array vazio
   * em `hourPlanQuotaRaw` era cota no Radar e não era na ficha.
   */
  temCotaNoContrato: boolean;
  segmentos: MapaDeSegmentos;
  horas: HorasDoCliente;
  /** Todas as horas reservadas no mês corrente, qualquer status. */
  horasNoMes: Money;
  /**
   * Horas AVULSAS no mês: reserva com venda de valor, fora da cota — cobrada na
   * hora ou na fatura do mês seguinte. Ver `ehHoraAvulsa`.
   */
  horasAvulsasNoMes: Money;
  reservasNoMes: number;
  /** Houve reserva abatida da cota nos últimos N meses? Ver `temEvidenciaDeCota`. */
  evidenciaDeCota(meses: number): boolean;
  primeiraReservaEm: Date | null;
  serie: Array<{ mesKey: string; valor: Money }>;
  /** O cliente já tem SeaBox, e por qual via. */
  posseSeabox: "POR_COMPRA" | "POR_CORTESIA" | "NAO_POSSUI" | "DESCONHECIDO";
  temContratoSeaBox: boolean;
  /** TODOS os contratos, vigentes e encerrados — para mudança de contrato. */
  contratosParaValor: ContratoParaValor[];
  /** Cobranças vencidas ou renegociadas do último ano — para o freio e a tendência. */
  cobrancas: CobrancaParaFreio[];
  /** Receita do mês em curso até agora. Só pode DESMENTIR uma queda. */
  receitaMesEmCurso: Money | null;
  /** O freio acionado, quando está. `null` = ofertas liberadas. */
  freio: { nome: string; motivo: string } | null;
}

export async function sinaisDoCliente(customerConexaId: number): Promise<Sinal[]> {
  const hoje = keyToUtcDate(todayKey());
  const mesAtual = currentMonthKey();

  const [gatilhos, segmentos] = await Promise.all([carregarGatilhos(), carregarSegmentos()]);

  // Os ciclos do excedente são parâmetro do gatilho "extra" — lidos antes da
  // consulta porque `horasDoCliente` precisa deles.
  const pExcedente = lerParams("EXCEDENTE", gatilhos.porCodigo.get("extra")?.params).params;

  // Um ano de cobranças basta: o freio olha até 105 dias e a tendência, meses.
  const umAnoAtras = new Date(hoje);
  umAnoAtras.setUTCDate(umAnoAtras.getUTCDate() - 400);

  const [contratos, horas, bookings, mensais, vendas, todosContratos, cobrancasBrutas] = await Promise.all([
    prisma.contract.findMany({
      where: {
        customerConexaId,
        isActive: true,
        OR: [{ endDate: null }, { endDate: { gte: hoje } }],
      },
      orderBy: { startDate: "asc" },
    }),
    horasDoCliente(customerConexaId, undefined, {
      ciclosAnalisados: pExcedente.ciclosAnalisados,
      ciclosComEstouro: pExcedente.ciclosComEstouro,
    }),
    prisma.roomBooking.findMany({
      where: { customerConexaId, isActive: true, cancellationReason: null },
      select: { dataLocal: true, horas: true, status: true, saleConexaId: true },
      orderBy: { dataLocal: "asc" },
    }),
    prisma.customerMonthlyRevenue.findMany({
      where: { customerConexaId },
      select: { mesKey: true, receita: true },
      orderBy: { mesKey: "asc" },
    }),
    prisma.sale.findMany({ where: { customerConexaId }, select: { productConexaId: true } }),
    prisma.contract.findMany({
      where: { customerConexaId },
      select: {
        conexaId: true,
        planConexaId: true,
        amount: true,
        paymentFrequency: true,
        startDate: true,
        endDate: true,
        isActive: true,
      },
    }),
    prisma.charge.findMany({
      where: {
        customerConexaId,
        status: { in: ["unpaid", "negotiated"] },
        OR: [{ dueDate: { gte: umAnoAtras } }, { emissionDate: { gte: umAnoAtras } }],
      },
      select: { status: true, dueDate: true, emissionDate: true, amount: true, currentAmount: true },
    }),
  ]);

  const planoIds = [
    ...new Set(
      [...contratos, ...todosContratos].map((c) => c.planConexaId).filter((x): x is number => x !== null),
    ),
  ];
  const planos = planoIds.length
    ? await prisma.plan.findMany({ where: { conexaId: { in: planoIds } } })
    : [];
  const catIds = [...new Set(planos.map((p) => p.serviceCategoryConexaId).filter((x): x is number => x !== null))];
  const categorias = catIds.length
    ? await prisma.serviceCategory.findMany({ where: { conexaId: { in: catIds } } })
    : [];
  const nomeCat = new Map(categorias.map((c) => [c.conexaId, c.name ?? ""]));
  const planoPor = new Map(planos.map((p) => [p.conexaId, p]));

  /** Categoria de serviço do contrato — a fonte legítima de segmento. */
  const categoriaDo = (planConexaId: number | null) => {
    const p = planConexaId !== null ? planoPor.get(planConexaId) : undefined;
    const id = p?.serviceCategoryConexaId ?? null;
    return { id, nome: id != null ? nomeCat.get(id) ?? "" : "" };
  };

  const doMes = bookings.filter(
    (b) => b.dataLocal && b.dataLocal.toISOString().slice(0, 7) === mesAtual,
  );
  const horasNoMes = doMes.reduce((acc, b) => acc.plus(money(b.horas?.toString() ?? 0)), money(0));
  // O valor da venda de cada reserva do mês — é o que diz se a hora é paga.
  const idsDeVenda = [...new Set(doMes.map((b) => b.saleConexaId).filter((x): x is number => x !== null))];
  const valorDaVenda = new Map(
    (idsDeVenda.length
      ? await prisma.sale.findMany({
          where: { conexaId: { in: idsDeVenda } },
          select: { conexaId: true, amount: true },
        })
      : []
    ).map((v) => [v.conexaId, Number(v.amount)]),
  );
  const horasAvulsasNoMes = doMes
    .filter((b) =>
      ehHoraAvulsa({
        status: b.status,
        valorDaVenda: b.saleConexaId !== null ? valorDaVenda.get(b.saleConexaId) ?? null : null,
      }),
    )
    .reduce((acc, b) => acc.plus(money(b.horas?.toString() ?? 0)), money(0));
  const reservasNoMes = doMes.length;
  const evidenciaDeCota = (meses: number) =>
    temEvidenciaDeCota({ reservas: bookings, desde: inicioDaJanela(mesAtual, meses) });
  const primeiraReservaEm = bookings.find((b) => b.dataLocal)?.dataLocal ?? null;

  const fechados = new Set(ultimosMesesFechados(12));
  const serie = mensais
    .filter((m) => fechados.has(m.mesKey))
    .map((m) => ({ mesKey: m.mesKey, valor: money(m.receita.toString()) }));

  /**
   * O cliente já comprou SeaBox?
   *
   * ⚠ Duas vias, com procedências diferentes (ver `posseDoProduto`):
   *
   * - **compra** — RESPONDÍVEL: o SeaBox tem categoria de serviço própria no
   *   Conexa, então basta olhar a categoria do produto vendido.
   * - **cortesia** — segue sem resposta: quais planos embutem SeaBox não existe
   *   na API, é cadastro.
   *
   * Então quem COMPROU recebe um veredicto definitivo (não ofertar); quem não
   * comprou continua ambíguo, porque pode ter recebido de cortesia.
   */
  const compradas = [...new Set(vendas.map((v) => v.productConexaId).filter((x): x is number => x !== null))];
  const produtosComprados = compradas.length
    ? await prisma.product.findMany({
        where: { conexaId: { in: compradas } },
        select: { conexaId: true, serviceCategoryConexaId: true },
      })
    : [];
  const catsDosComprados = [
    ...new Set(produtosComprados.map((p) => p.serviceCategoryConexaId).filter((x): x is number => x !== null)),
  ];
  const catsSeaBox = catsDosComprados.length
    ? await prisma.serviceCategory.findMany({
        where: { conexaId: { in: catsDosComprados } },
        select: { conexaId: true, name: true },
      })
    : [];
  const idsCatSeaBox = new Set(
    catsSeaBox.filter((c) => segmentos.ehSeaBox(c.conexaId, c.name)).map((c) => c.conexaId),
  );
  const comprouSeaBox = produtosComprados.some(
    (p) => p.serviceCategoryConexaId !== null && idsCatSeaBox.has(p.serviceCategoryConexaId),
  );

  /**
   * ⚠ Terceira via de posse, descoberta olhando a produção em 2026-08-27: a
   * categoria SeaBox tem **6 PLANOS**, não só produtos. Então o cliente pode ter
   * SeaBox por CONTRATO, e não apenas por venda avulsa.
   *
   * Eu só olhava `/sales`. Um cliente com contrato de SeaBox ativo receberia a
   * oferta de SeaBox — a reoferta exata que a supressão existe para impedir.
   */
  const temContratoSeaBox = contratos.some((c) => {
    const cat = categoriaDo(c.planConexaId);
    return segmentos.ehSeaBox(cat.id, cat.nome);
  });

  const posseSeabox =
    comprouSeaBox || temContratoSeaBox
      ? ("POR_COMPRA" as const)
      : posseDoProduto({ produtoAlvo: -1, comprados: [], cortesiasDoPlano: null });

  const planoSemCota = (planConexaId: number | null) => {
    const p = planConexaId !== null ? planoPor.get(planConexaId) : undefined;
    return p?.horasInclusasMes == null;
  };

  const contratosParaValor: ContratoParaValor[] = todosContratos.map((c) => ({
    conexaId: c.conexaId,
    amount: money(c.amount.toString()),
    paymentFrequency: c.paymentFrequency,
    startDate: c.startDate,
    endDate: c.endDate,
    isActive: c.isActive,
    foraDaPermanencia: segmentos.foraDaPermanencia(categoriaDo(c.planConexaId).id),
  }));
  const temCotaNoContrato = contratos.some(
    (c) =>
      concessaoDoContrato(c, c.planConexaId !== null ? planoPor.get(c.planConexaId) : undefined).concedido !== null,
  );
  const cobrancas: CobrancaParaFreio[] = cobrancasBrutas.map((c) => ({
    status: c.status,
    dueDate: c.dueDate,
    emissionDate: c.emissionDate,
    valor: money((c.currentAmount ?? c.amount).toString()),
  }));
  const emCurso = mensais.find((m) => m.mesKey === mesAtual);

  /**
   * O freio é avaliado ANTES dos outros gatilhos, porque os suspende. Qualquer
   * gatilho de saúde financeira ligado que acione basta — o comum é haver um só.
   */
  let freio: ContextoDoCliente["freio"] = null;
  for (const g of gatilhos.todos) {
    if (g.familia !== "SAUDE_FINANCEIRA" || !g.ativo || g.bloqueio) continue;
    const pf = lerParams("SAUDE_FINANCEIRA", g.params).params;
    const sf = situacaoFinanceira({ cobrancas, hoje, ...pf });
    if (sf.freiar) {
      freio = { nome: g.nome, motivo: sf.motivo! };
      break;
    }
  }

  const ctx: ContextoDoCliente = {
    hoje,
    mesAtual,
    contratos: contratos.map((c) => ({
      conexaId: c.conexaId,
      planConexaId: c.planConexaId,
      startDate: c.startDate,
    })),
    categoriaDo,
    planoSemCota,
    temCotaNoContrato,
    segmentos,
    horas,
    horasNoMes,
    horasAvulsasNoMes,
    reservasNoMes,
    evidenciaDeCota,
    primeiraReservaEm,
    serie,
    posseSeabox,
    temContratoSeaBox,
    contratosParaValor,
    cobrancas,
    receitaMesEmCurso: emCurso ? money(emCurso.receita.toString()) : null,
    freio,
  };

  // A ordem é a do catálogo (`ordem`), já aplicada por `carregarGatilhos`.
  return gatilhos.todos.map((g) => avaliarGatilho(g, ctx));
}

// ---------------------------------------------------------------------------
// Despacho por família
// ---------------------------------------------------------------------------

function avaliarGatilho(g: GatilhoResolvido, ctx: ContextoDoCliente): Sinal {
  const base = { regra: g.codigo, nome: g.nome, familia: g.familia, oferta: g.oferta };

  // ⚠ Bloqueio vence desligamento. Um gatilho bloqueado por permissão não muda
  // de comportamento quando alguém o liga; dizer "desligado" esconderia que o
  // problema está fora daqui — e mandaria a pessoa procurar o botão errado.
  if (g.bloqueio) {
    return { ...base, estado: "DADO_INDISPONIVEL", motivo: g.bloqueio };
  }
  if (!g.ativo) {
    return {
      ...base,
      estado: "NAO_APLICAVEL",
      desligado: true,
      motivo:
        "Gatilho desligado na tela Gatilhos" +
        (g.atualizadoPor ? ` por ${g.atualizadoPor}` : "") +
        (g.atualizadoEm ? ` em ${fmtDia(g.atualizadoEm)}` : "") +
        " — não é uma conclusão sobre este cliente.",
    };
  }
  if (g.problemaNosParams) {
    return {
      ...base,
      estado: "DADO_INDISPONIVEL",
      motivo: `Parâmetros ilegíveis (${g.problemaNosParams}) — avaliado com os valores de fábrica.`,
    };
  }

  const sinal = avaliarFamilia(g, ctx, base);

  /**
   * ⚠ O freio vem DEPOIS da avaliação, e não antes, de propósito. Suspender sem
   * avaliar esconderia do vendedor que o cliente bateria o marco — e ele não
   * saberia por que a oferta sumiu. Assim a ficha diz "dispararia, e está
   * suspenso", que é a informação inteira.
   */
  if (ctx.freio && FAMILIAS_DE_VENDA.has(g.familia) && (sinal.estado === "ATIVO" || sinal.estado === "AMBIGUO")) {
    return {
      ...sinal,
      estado: "NAO_APLICAVEL",
      motivo: `Dispararia (${sinal.evidencia ?? sinal.motivo}), mas está SUSPENSO pelo freio: ${ctx.freio.motivo}. Oferta de venda para quem está devendo é a conversa errada.`,
      evidencia: undefined,
    };
  }
  return sinal;
}

function avaliarFamilia(g: GatilhoResolvido, ctx: ContextoDoCliente, base: Base): Sinal {
  switch (g.familia) {
    case "EXCEDENTE":
      return excedente(g, ctx, base);
    case "MARCO_CONTRATO":
      return marco(g, ctx, base);
    case "USO_SEM_COTA":
      return usoSemCota(g, ctx, base);
    case "PRIMEIRO_EVENTO":
      return primeiroEvento(g, ctx, base);
    case "EVENTO_EM_SEGMENTO":
      return eventoEmSegmento(g, ctx, base);
    case "TENDENCIA":
      return tendencia(g, ctx, base);
    case "MUDANCA_CONTRATO":
      return mudancaContrato(g, ctx, base);
    case "SAUDE_FINANCEIRA":
      return freioDoCliente(g, ctx, base);
    case "SALDO_COTA":
      return {
        ...base,
        estado: "DADO_INDISPONIVEL",
        motivo: LACUNA_SALDO_PACOTE.charAt(0).toUpperCase() + LACUNA_SALDO_PACOTE.slice(1) + ".",
      };
  }
}

function mudancaContrato(g: GatilhoResolvido, ctx: ContextoDoCliente, base: Base): Sinal {
  const p = lerParams("MUDANCA_CONTRATO", g.params).params;
  const r = mudancaDeContrato({
    contratos: ctx.contratosParaValor,
    hoje: ctx.hoje,
    janelaDias: p.janelaDias,
    limiarPct: p.limiarPct,
  });
  const brl = (v: Money | null) => (v ? formatBRL(v) : "R$ 0,00");

  if (p.modo === "concluiu") {
    if (r.concluiu) {
      return {
        ...base,
        estado: "ATIVO",
        motivo: `Contrato #${r.programaEncerrado!.conexaId}, de categoria PROGRAMA, terminou em ${fmtDia(r.programaEncerrado!.endDate!)} — e o cliente não tem contrato de permanência. É egresso, não ex-cliente: a conversa é de continuidade.`,
        evidencia: `concluiu em ${fmtDia(r.programaEncerrado!.endDate!)}`,
      };
    }
    return {
      ...base,
      estado: "NAO_APLICAVEL",
      motivo: r.programaEncerrado
        ? `Concluiu um programa, mas já tem contrato de permanência (${brl(r.agora)}/mês).`
        : `Nenhum contrato de categoria PROGRAMA terminou nos últimos ${p.janelaDias} dias.`,
    };
  }

  if (p.modo === "perdeu") {
    if (r.perdeu) {
      return {
        ...base,
        estado: "ATIVO",
        motivo: `Contrato #${r.encerrado!.conexaId} terminou em ${fmtDia(r.encerrado!.endDate!)} e não há outro vigente. Tinha ${brl(r.antes)}/mês contratado ${p.janelaDias} dias atrás.`,
        evidencia: `saiu em ${fmtDia(r.encerrado!.endDate!)}`,
      };
    }
    return {
      ...base,
      estado: "NAO_APLICAVEL",
      motivo:
        r.agora && r.agora.greaterThan(0)
          ? `Tem contrato vigente (${brl(r.agora)}/mês).`
          : `Nenhum contrato terminou nos últimos ${p.janelaDias} dias.`,
    };
  }

  if (r.reduziu) {
    return {
      ...base,
      estado: "ATIVO",
      motivo: `Valor mensal contratado caiu de ${brl(r.antes)} para ${brl(r.agora)} nos últimos ${p.janelaDias} dias (${num(r.variacaoPct!)}%).`,
      evidencia: `${num(r.variacaoPct!)}%`,
    };
  }
  return {
    ...base,
    estado: "NAO_APLICAVEL",
    // ⚠ `!r.antes` não pega contrato de valor ZERO (é um Decimal, e objeto é
    // verdadeiro): a ficha dizia "variou 0,0% (R$ 0,00 → R$ 0,00)".
    motivo: !r.antes || r.antes.lessThanOrEqualTo(0)
      ? `Sem valor contratado ${p.janelaDias} dias atrás — não há base para comparar.`
      : !r.agora || r.agora.lessThanOrEqualTo(0)
        ? "Sem contrato vigente hoje — isso é o gatilho \"perdeu o contrato\", não redução."
        : `Valor mensal contratado ${r.variacaoPct === 0 ? "igual" : `variou ${num(r.variacaoPct ?? 0)}%`} nos últimos ${p.janelaDias} dias (${brl(r.antes)} → ${brl(r.agora)}).`,
  };
}

function freioDoCliente(g: GatilhoResolvido, ctx: ContextoDoCliente, base: Base): Sinal {
  const p = lerParams("SAUDE_FINANCEIRA", g.params).params;
  const r = situacaoFinanceira({ cobrancas: ctx.cobrancas, hoje: ctx.hoje, ...p });
  if (r.freiar) {
    return {
      ...base,
      estado: "ATIVO",
      motivo: `${r.motivo}${r.valorVencido ? ` — ${formatBRL(r.valorVencido)} vencidos` : ""}. As ofertas de venda deste cliente estão suspensas; os sinais de saída continuam.`,
      evidencia: r.vencidas ? `${r.vencidas} vencida(s), ${r.maiorAtrasoDias} dias` : "renegociou",
    };
  }
  return {
    ...base,
    estado: "NAO_APLICAVEL",
    motivo: `Sem cobrança vencida há ${p.diasDeAtrasoMin}–${p.diasDeAtrasoMax} dias e sem renegociação nos últimos ${p.diasDeRenegociacao} — ofertas liberadas.`,
  };
}

type Base = Pick<Sinal, "regra" | "nome" | "familia" | "oferta">;

function excedente(g: GatilhoResolvido, ctx: ContextoDoCliente, base: Base): Sinal {
  const { horas } = ctx;
  if (horas.semContrato) {
    return {
      ...base,
      estado: "NAO_APLICAVEL",
      motivo: "Cliente sem contrato ativo com plano — não há cota a estourar.",
    };
  }
  if (horas.atribuicaoAmbigua) {
    return {
      ...base,
      estado: "AMBIGUO",
      motivo: "Mais de um contrato com cota: a reserva não diz de qual balde a hora saiu.",
    };
  }
  if (horas.sinal?.recorrente) {
    return {
      ...base,
      estado: "ATIVO",
      motivo: `Estourou em ${horas.sinal.ciclosComEstouro} de ${horas.sinal.ciclosConclusivos} ciclos conclusivos.`,
      evidencia: `${h(horas.sinal.horasExcedentes)} pagas por fora do plano`,
    };
  }
  const p = lerParams("EXCEDENTE", g.params).params;
  return {
    ...base,
    estado: "NAO_APLICAVEL",
    motivo: horas.sinal
      ? `Estourou em ${horas.sinal.ciclosComEstouro} de ${horas.sinal.ciclosConclusivos} ciclos — o gatilho exige ${p.ciclosComEstouro}.`
      : "Sem ciclos fechados suficientes para avaliar.",
  };
}

function marco(g: GatilhoResolvido, ctx: ContextoDoCliente, base: Base): Sinal {
  const p = lerParams("MARCO_CONTRATO", g.params).params;
  const rotuloSeg =
    p.segmento === "SALA_PRIVATIVA"
      ? "sala privativa"
      : p.segmento === "ENDERECO_FISCAL"
        ? "Endereço Fiscal"
        : p.segmento === "SEABOX"
          ? "SeaBox"
          : null;

  const candidatos = ctx.contratos.filter((c) => {
    if (p.segmento === "QUALQUER") return true;
    const cat = ctx.categoriaDo(c.planConexaId);
    return ctx.segmentos.de(cat.id, cat.nome) === p.segmento;
  });

  const plural = p.meses === 1 ? "mês" : "meses";

  if (!candidatos.length) {
    return {
      ...base,
      estado: "NAO_APLICAVEL",
      motivo: rotuloSeg
        ? `Nenhum contrato ativo de ${rotuloSeg}.`
        : "Nenhum contrato ativo.",
    };
  }

  const semData = candidatos.filter((c) => !c.startDate);
  const atingiu = candidatos.find(
    (c) =>
      c.startDate &&
      marcoAtingido({
        inicio: c.startDate,
        meses: p.meses,
        hoje: ctx.hoje,
        toleranciaDias: p.toleranciaDias,
      }),
  );

  if (atingiu) {
    return {
      ...base,
      estado: "ATIVO",
      motivo: `Contrato #${atingiu.conexaId} completou ${p.meses} ${plural} (âncora startDate).`,
      evidencia: `desde ${fmtDia(atingiu.startDate!)}`,
    };
  }
  if (semData.length === candidatos.length) {
    return {
      ...base,
      estado: "DADO_INDISPONIVEL",
      motivo: "Contrato sem `startDate` — não há de onde contar o marco.",
    };
  }
  return {
    ...base,
    estado: "NAO_APLICAVEL",
    motivo: `Nenhum contrato no marco de ${p.meses} ${plural} hoje.`,
  };
}

function usoSemCota(g: GatilhoResolvido, ctx: ContextoDoCliente, base: Base): Sinal {
  const p = lerParams("USO_SEM_COTA", g.params).params;
  const cotaNoContrato = ctx.temCotaNoContrato;
  // ⚠ Pacote via venda recorrente não aparece em contrato nem plano, mas o
  // Conexa abate as reservas dele. Sem isto, a regra reofertava pacote a quem
  // já tinha pacote — medido em 2026-09-18.
  const cotaPorEvidencia = ctx.evidenciaDeCota(p.mesesDeEvidenciaDeCota);
  const temCota = cotaNoContrato || cotaPorEvidencia;

  if (
    usoAvulsoAlto({ temContratoComCota: temCota, horasNoMes: ctx.horasAvulsasNoMes, limiarHoras: p.limiarHoras })
  ) {
    return {
      ...base,
      estado: "ATIVO",
      motivo: `Sem cota e ${h(ctx.horasAvulsasNoMes)} pagas como avulso em ${ctx.mesAtual}. ⚠ A economia vs. avulso não sai: a API não expõe preço por hora.`,
      evidencia: `${h(ctx.horasAvulsasNoMes)} avulsas no mês`,
    };
  }

  const naoFaturadas = ctx.horasNoMes.minus(ctx.horasAvulsasNoMes);
  return {
    ...base,
    estado: "NAO_APLICAVEL",
    motivo: cotaNoContrato
      ? "Tem contrato com cota — este gatilho é para quem só compra avulso."
      : cotaPorEvidencia
        ? `Tem reserva abatida da cota nos últimos ${p.mesesDeEvidenciaDeCota} meses — já tem pacote de horas, não é cliente de avulso.`
        : naoFaturadas.greaterThan(0) && ctx.horasAvulsasNoMes.isZero()
          ? `As ${h(naoFaturadas)} reservadas em ${ctx.mesAtual} não têm venda com valor — é cortesia, não compra avulsa.`
          : `${h(ctx.horasAvulsasNoMes)} pagas como avulso no mês, abaixo do limiar de ${p.limiarHoras}h.`,
  };
}

function primeiroEvento(g: GatilhoResolvido, ctx: ContextoDoCliente, base: Base): Sinal {
  const p = lerParams("PRIMEIRO_EVENTO", g.params).params;
  const estreou = primeiraReserva({
    primeiraReservaEm: ctx.primeiraReservaEm,
    hoje: ctx.hoje,
    dataDeCorte: keyToUtcDate(p.desde),
    toleranciaDias: p.toleranciaDias,
  });

  if (!estreou) {
    return {
      ...base,
      estado: "NAO_APLICAVEL",
      motivo: ctx.primeiraReservaEm
        ? `Primeira reserva em ${fmtDia(ctx.primeiraReservaEm)} — fora da janela de estreia (corte em ${p.desde}).`
        : "Cliente nunca reservou sala.",
    };
  }

  // ⚠ Já tem SeaBox → NÃO ofertar. É a supressão funcionando, e o estado certo
  // é "não aplicável", não "ativo": a regra existe, mas esta oferta específica
  // já foi atendida.
  if (ctx.posseSeabox === "POR_COMPRA") {
    return {
      ...base,
      estado: "NAO_APLICAVEL",
      motivo: `Estreou em ${fmtDia(ctx.primeiraReservaEm!)}, mas o cliente JÁ TEM SeaBox (${
        ctx.temContratoSeaBox ? "contrato ativo" : "compra registrada"
      }) — não reofertar.`,
    };
  }

  return {
    ...base,
    estado: "AMBIGUO",
    motivo: `Estreou em ${fmtDia(ctx.primeiraReservaEm!)}. Não comprou SeaBox, mas não dá para saber se o plano dele já embute de cortesia — esse mapeamento não existe na API.`,
    evidencia: `estreia em ${fmtDia(ctx.primeiraReservaEm!)}`,
  };
}

function eventoEmSegmento(g: GatilhoResolvido, ctx: ContextoDoCliente, base: Base): Sinal {
  const p = lerParams("EVENTO_EM_SEGMENTO", g.params).params;

  // ⚠ O tier vem da COTA do plano, nunca do nome: Litoral = sem cota,
  // Batial = 2h, Abissal = 8h, medido na Fase 0.
  const litoral = ctx.contratos.some((c) => {
    const cat = ctx.categoriaDo(c.planConexaId);
    if (!ctx.segmentos.ehFiscal(cat.id, cat.nome)) return false;
    return ctx.planoSemCota(c.planConexaId);
  });

  // Quem já tem pacote não recebe oferta de pacote — mesmo freio da regra 4.
  if (litoral && ctx.evidenciaDeCota(p.mesesDeEvidenciaDeCota)) {
    return {
      ...base,
      estado: "NAO_APLICAVEL",
      motivo: `Endereço Fiscal sem horas no plano, mas com reserva abatida da cota nos últimos ${p.mesesDeEvidenciaDeCota} meses — já tem pacote de horas.`,
    };
  }

  if (
    litoralReservouSala({ temPlanoFiscalSemCota: litoral, reservasNoPeriodo: ctx.reservasNoMes }) &&
    ctx.reservasNoMes >= p.reservasMinimas
  ) {
    return {
      ...base,
      estado: "ATIVO",
      motivo: `Endereço Fiscal sem horas inclusas, com ${ctx.reservasNoMes} reserva(s) em ${ctx.mesAtual}.`,
      evidencia: `${ctx.reservasNoMes} reserva(s)`,
    };
  }
  return {
    ...base,
    estado: "NAO_APLICAVEL",
    motivo: litoral
      ? `${ctx.reservasNoMes} reserva(s) em ${ctx.mesAtual}, abaixo do mínimo de ${p.reservasMinimas}.`
      : "Não tem plano de Endereço Fiscal sem cota.",
  };
}

function tendencia(g: GatilhoResolvido, ctx: ContextoDoCliente, base: Base): Sinal {
  const p = lerParams("TENDENCIA", g.params).params;

  /**
   * ⚠ Quem renegociou no período não tem "queda de receita": tem cobrança
   * trocada. A régua de receita exclui a renegociada (para não contar em
   * dobro), e o que sobra parece queda de 100% — medido em 2026-09-18: 4 dos 14
   * sinais eram isso, com a cobrança nova de setembro somando as antigas.
   * AMBIGUO, e não "não aplicável": o sistema não sabe, e diz que não sabe.
   */
  const mesesOlhados = p.modo === "queda_sustentada" ? p.mesesAvaliados : p.modo === "quedas_seguidas" ? p.quedasSeguidas : 1;
  const desdeReneg = inicioDaJanela(ctx.mesAtual, mesesOlhados + 1);
  const renegociou = ctx.cobrancas.some((c) => {
    const ref = c.dueDate ?? c.emissionDate;
    return c.status === "negotiated" && !!ref && ref >= desdeReneg;
  });
  if (renegociou) {
    return {
      ...base,
      estado: "AMBIGUO",
      motivo: "Renegociou cobranças no período avaliado — a receita desses meses mostra a troca de cobrança, não o que o cliente contratou. Não dá para afirmar queda.",
    };
  }

  if (p.modo === "queda_sustentada") {
    const r = quedaSustentada({
      serie: ctx.serie,
      mesesAvaliados: p.mesesAvaliados,
      mesesDeBase: p.mesesDeBase,
      limiarPct: p.limiarPct,
      mesEmCurso: ctx.receitaMesEmCurso,
      baseMinima: p.baseMinima,
    });
    if (r.semBase === "SERIE_CURTA") {
      return { ...base, estado: "DADO_INDISPONIVEL", motivo: `Menos de ${p.mesesAvaliados + 3} meses fechados — não há base para comparar.` };
    }
    if (r.semBase === "BASE_ZERO") {
      return { ...base, estado: "NAO_APLICAVEL", motivo: "Sem receita típica nos meses de base (mediana zero) — não existe base, e zero depois de zero não é queda." };
    }
    if (r.semBase === "BASE_PEQUENA") {
      return {
        ...base,
        estado: "NAO_APLICAVEL",
        motivo: `Receita típica de ${formatBRL(r.base!)}/mês, abaixo do mínimo de ${formatBRL(p.baseMinima)} — pequena demais para chamar variação de queda.`,
      };
    }
    const baseTxt = formatBRL(r.base!);
    if (r.disparou) {
      return {
        ...base,
        estado: "ATIVO",
        motivo: `${r.avaliados.join(" e ")} abaixo de ${100 - p.limiarPct}% do normal (mediana de ${baseTxt}); em média ${num(r.variacaoPct!)}%.`,
        evidencia: `${num(r.variacaoPct!)}% por ${r.avaliados.length} meses`,
      };
    }
    return {
      ...base,
      estado: "NAO_APLICAVEL",
      motivo: r.desmentidoPeloMesEmCurso
        ? `${r.avaliados.join(" e ")} vieram abaixo do normal, mas o mês em curso já passou de ${100 - p.limiarPct}% da mediana (${baseTxt}) — era calendário de cobrança, não queda.`
        : `Não ficou ${r.avaliados.length} meses seguidos abaixo de ${100 - p.limiarPct}% da mediana (${baseTxt}).`,
    };
  }

  if (p.modo === "quedas_seguidas") {
    const queda = quedaMesAMes({
      serie: ctx.serie,
      quedasSeguidas: p.quedasSeguidas,
      quedaMinimaPct: p.quedaMinimaPct,
    });
    if (queda.disparou) {
      return {
        ...base,
        // ⚠ AMBIGUO e não ATIVO: avaliado sobre RECEITA, e falta o cliente
        // definir se "comprou 20h" é compra ou consumo — vêm de endpoints
        // diferentes.
        estado: "AMBIGUO",
        motivo: `Receita caiu em ${queda.quedas} meses seguidos (${queda.de} → ${queda.ate}). ⚠ Avaliado sobre RECEITA: falta o cliente definir se "comprou 20h" é compra ou consumo.`,
        evidencia: `${queda.quedas} quedas seguidas`,
      };
    }
    return {
      ...base,
      estado: "NAO_APLICAVEL",
      motivo:
        ctx.serie.length < p.quedasSeguidas + 1
          ? "Série curta demais para avaliar tendência."
          : `Sem ${p.quedasSeguidas} quedas seguidas nos meses fechados.`,
    };
  }

  const r = quedaContraBase({ serie: ctx.serie, mesesDeBase: p.mesesDeBase, limiarPct: p.limiarPct });
  if (r.semBase === "SERIE_CURTA") {
    return {
      ...base,
      estado: "DADO_INDISPONIVEL",
      motivo: `Menos de ${p.mesesDeBase + 1} meses fechados — não há base para comparar.`,
    };
  }
  if (r.semBase === "BASE_ZERO" || r.variacaoPct === null) {
    return {
      ...base,
      estado: "NAO_APLICAVEL",
      motivo: `Sem receita típica nos ${p.mesesDeBase} meses anteriores (mediana zero) — não existe base, e zero depois de zero não é queda. É o caso do contrato anual.`,
    };
  }
  const baseTxt = formatBRL(r.base!);
  if (r.disparou) {
    return {
      ...base,
      estado: "ATIVO",
      motivo: `Caiu ${num(Math.abs(r.variacaoPct))}% em ${r.mesAvaliado} contra a mediana dos ${p.mesesDeBase} meses anteriores (${baseTxt}); limiar de ${p.limiarPct}%.`,
      evidencia: `${num(r.variacaoPct)}%`,
    };
  }
  return {
    ...base,
    estado: "NAO_APLICAVEL",
    // ⚠ Subir NÃO é "dentro do limiar de queda". A mensagem antiga dizia
    // "variação de 77.4%, dentro do limiar de 30%" para um cliente que CRESCEU
    // 77% — número certo, motivo mentiroso.
    motivo:
      r.variacaoPct >= 0
        ? `${r.mesAvaliado} ficou ${r.variacaoPct === 0 ? "igual à" : `${num(r.variacaoPct)}% acima da`} mediana dos ${p.mesesDeBase} meses anteriores (${baseTxt}) — não é queda.`
        : `Caiu ${num(Math.abs(r.variacaoPct))}% contra a mediana (${baseTxt}), dentro do limiar de ${p.limiarPct}%.`,
  };
}

/** 1º dia do mês `meses - 1` meses antes de `mesAtual`: a janela "últimos N meses". */
function inicioDaJanela(mesAtual: string, meses: number): Date {
  const [a, m] = mesAtual.split("-").map(Number);
  return new Date(Date.UTC(a!, m! - 1 - (Math.max(1, meses) - 1), 1));
}

function fmtDia(d: Date): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(d);
}
