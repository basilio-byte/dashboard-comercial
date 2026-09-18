import "server-only";
import { prisma } from "@/lib/db";
import { keyToUtcDate, todayKey, currentMonthKey, ultimosMesesFechados } from "@/lib/dates";
import { formatBRL, money, type Money } from "@/lib/money";
import { horasDoCliente, type HorasDoCliente } from "@/lib/intel/horas";
import { faturada } from "@/lib/metrics/horas";
import {
  litoralReservouSala,
  marcoAtingido,
  posseDoProduto,
  primeiraReserva,
  quedaContraBase,
  quedaMesAMes,
  temEvidenciaDeCota,
  usoAvulsoAlto,
} from "./familias";
import { carregarGatilhos, type GatilhoResolvido } from "./config";
import { lerParams } from "./catalogo";
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
  segmentos: MapaDeSegmentos;
  horas: HorasDoCliente;
  /** Todas as horas reservadas no mês corrente, qualquer status. */
  horasNoMes: Money;
  /**
   * Só as horas FATURADAS como avulso no mês (billed, paid, partiallyPaid).
   * É o que a regra 4 quer dizer com "compra hora avulsa": quem tem reserva
   * `notBilled` não está pagando por hora, e a oferta "pacote sai mais barato
   * que avulso" não se aplica a ele.
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
}

export async function sinaisDoCliente(customerConexaId: number): Promise<Sinal[]> {
  const hoje = keyToUtcDate(todayKey());
  const mesAtual = currentMonthKey();

  const [gatilhos, segmentos] = await Promise.all([carregarGatilhos(), carregarSegmentos()]);

  // Os ciclos do excedente são parâmetro do gatilho "extra" — lidos antes da
  // consulta porque `horasDoCliente` precisa deles.
  const pExcedente = lerParams("EXCEDENTE", gatilhos.porCodigo.get("extra")?.params).params;

  const [contratos, horas, bookings, mensais, vendas] = await Promise.all([
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
      select: { dataLocal: true, horas: true, status: true },
      orderBy: { dataLocal: "asc" },
    }),
    prisma.customerMonthlyRevenue.findMany({
      where: { customerConexaId },
      select: { mesKey: true, receita: true },
      orderBy: { mesKey: "asc" },
    }),
    prisma.sale.findMany({ where: { customerConexaId }, select: { productConexaId: true } }),
  ]);

  const planoIds = [...new Set(contratos.map((c) => c.planConexaId).filter((x): x is number => x !== null))];
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
  const horasAvulsasNoMes = doMes
    .filter((b) => faturada({ status: b.status }))
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
    case "SALDO_COTA":
      return {
        ...base,
        estado: "DADO_INDISPONIVEL",
        motivo:
          "As horas do pacote comprado vêm de `recurringSales.packageId`, e `/packages` responde " +
          "404 por permissão deste token. O saldo não é calculável — depende de o admin do Conexa " +
          "liberar o endpoint.",
      };
  }
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
  const cotaNoContrato = ctx.horas.contratos.some((c) => c.concedido !== null);
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
      motivo: `Sem cota e ${h(ctx.horasAvulsasNoMes)} faturadas como avulso em ${ctx.mesAtual}. ⚠ A economia vs. avulso não sai: a API não expõe preço por hora.`,
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
        : naoFaturadas.greaterThan(0)
          ? `${h(ctx.horasAvulsasNoMes)} faturadas como avulso em ${ctx.mesAtual}; outras ${h(naoFaturadas)} reservadas não são cobradas — não é compra avulsa.`
          : `${h(ctx.horasAvulsasNoMes)} faturadas como avulso no mês, abaixo do limiar de ${p.limiarHoras}h.`,
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
