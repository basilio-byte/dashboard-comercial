import "server-only";
import { prisma } from "@/lib/db";
import { keyToUtcDate, todayKey, currentMonthKey, nowInAppTz, ultimosMesesFechados } from "@/lib/dates";
import { money } from "@/lib/money";
import { estadoDoEspelho } from "@/lib/intel/completude";
import { clientesComExcedente } from "@/lib/intel/horas";
import type { ResultadoContato } from "@prisma/client";
import {
  litoralReservouSala,
  marcoAtingido,
  quedaMesAMes,
  quedaPercentual,
  usoAvulsoAlto,
} from "./familias";
import { carregarGatilhos, type GatilhoResolvido } from "./config";
import { lerParams } from "./catalogo";
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
   * opostas: pedir liberação ao admin do Conexa, religar na tela, ou esperar a
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
    },
  });
  const idsClientes = [...new Set(contratos.map((c) => c.customerConexaId!))];

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
  const nomePor = new Map(elegiveis.map((c) => [c.conexaId, c.name]));
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
  const inicioMes = keyToUtcDate(`${mesAtual}-01`);
  const [reservasDoMes, primeiras, mensais, perfis, contatos] = await Promise.all([
    prisma.roomBooking.findMany({
      where: {
        customerConexaId: { in: alvos },
        isActive: true,
        cancellationReason: null,
        dataLocal: { gte: inicioMes },
      },
      select: { customerConexaId: true, horas: true },
    }),
    prisma.roomBooking.groupBy({
      by: ["customerConexaId"],
      where: { customerConexaId: { in: alvos }, isActive: true, cancellationReason: null },
      _min: { dataLocal: true },
    }),
    prisma.customerMonthlyRevenue.findMany({
      where: { customerConexaId: { in: alvos }, mesKey: { in: ultimosMesesFechados(12) } },
      select: { customerConexaId: true, mesKey: true, receita: true },
    }),
    prisma.customerProfile.findMany({
      where: { customerConexaId: { in: alvos } },
      select: { customerConexaId: true, receitaAnoCorrente: true, segmentos: true },
    }),
    // ⚠ Sugestão do Diego: sem o último contato, a fila mostra o mesmo cliente
    // todo dia, inclusive para quem já ligou ontem — e o vendedor aprende a
    // ignorá-la. É assim que uma ferramenta de recomendação morre.
    prisma.contato.findMany({
      where: { customerConexaId: { in: alvos } },
      orderBy: { contatoEm: "desc" },
      select: { customerConexaId: true, contatoEm: true, quem: true, resultado: true },
    }),
  ]);

  const horasNoMesPor = new Map<number, ReturnType<typeof money>>();
  const reservasNoMesPor = new Map<number, number>();
  for (const b of reservasDoMes) {
    if (b.customerConexaId === null) continue;
    horasNoMesPor.set(
      b.customerConexaId,
      (horasNoMesPor.get(b.customerConexaId) ?? money(0)).plus(money(b.horas?.toString() ?? 0)),
    );
    reservasNoMesPor.set(b.customerConexaId, (reservasNoMesPor.get(b.customerConexaId) ?? 0) + 1);
  }
  const primeiraPor = new Map(
    primeiras.filter((g) => g.customerConexaId !== null).map((g) => [g.customerConexaId!, g._min.dataLocal]),
  );
  const seriePor = new Map<number, Array<{ mesKey: string; valor: ReturnType<typeof money> }>>();
  for (const m of mensais) {
    const l = seriePor.get(m.customerConexaId) ?? [];
    l.push({ mesKey: m.mesKey, valor: money(m.receita.toString()) });
    seriePor.set(m.customerConexaId, l);
  }
  const perfilPor = new Map(perfis.map((p) => [p.customerConexaId, p]));
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
  const add = (id: number, g: GatilhoResolvido, evidencia: string, peso: number) =>
    itens.push({
      customerConexaId: id,
      nome: nomePor.get(id) ?? null,
      regra: g.codigo,
      nomeDaRegra: g.nome,
      familia: g.familia,
      oferta: g.oferta,
      evidencia,
      peso,
    });

  const porFamilia = (f: string) => ligados.filter((g) => g.familia === f);

  for (const [id, lista] of porCliente) {
    const temCota = lista.some((c) => {
      const p = c.planConexaId !== null ? planoPor.get(c.planConexaId) : undefined;
      return p?.horasInclusasMes != null || Array.isArray(c.hourPlanQuotaRaw);
    });

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
    const horas = horasNoMesPor.get(id) ?? money(0);
    for (const g of porFamilia("USO_SEM_COTA")) {
      const p = lerParams("USO_SEM_COTA", g.params).params;
      if (usoAvulsoAlto({ temContratoComCota: temCota, horasNoMes: horas, limiarHoras: p.limiarHoras })) {
        add(id, g, `${fmtH(horas)} no mês, sem cota`, g.peso + Number(horas) * 2);
      }
    }

    // ── PRIMEIRO_EVENTO ───────────────────────────────────────────────────
    for (const g of porFamilia("PRIMEIRO_EVENTO")) {
      const p = lerParams("PRIMEIRO_EVENTO", g.params).params;
      const primeira = primeiraPor.get(id) ?? null;
      if (
        primeira &&
        primeira >= keyToUtcDate(p.desde) &&
        marcoAtingido({ inicio: primeira, meses: 0, hoje, toleranciaDias: p.toleranciaDias })
      ) {
        add(id, g, "estreou agora", g.peso);
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
        nRes >= p.reservasMinimas
      ) {
        add(id, g, `${nRes} reserva(s) no mês`, g.peso + nRes);
      }
    }

    // ── TENDENCIA ─────────────────────────────────────────────────────────
    const serie = (seriePor.get(id) ?? []).sort((a, b) => a.mesKey.localeCompare(b.mesKey));
    for (const g of porFamilia("TENDENCIA")) {
      const p = lerParams("TENDENCIA", g.params).params;
      if (p.modo === "quedas_seguidas") {
        const q = quedaMesAMes({ serie, quedasSeguidas: p.quedasSeguidas });
        if (q.disparou) add(id, g, `${q.quedas} quedas seguidas`, g.peso + q.quedas * 5);
        continue;
      }
      const ult = serie.at(-1);
      const pen = serie.at(-2);
      if (!ult || !pen) continue;
      const pc = quedaPercentual({ atual: ult.valor, anterior: pen.valor, limiarPct: p.limiarPct });
      if (pc.disparou && pc.variacaoPct !== null) {
        add(id, g, `${pc.variacaoPct.toFixed(1).replace(".", ",")}% em ${ult.mesKey}`, g.peso + Math.abs(pc.variacaoPct));
      }
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
  for (const c of clientes.values()) c.sinais.sort((a, b) => b.peso - a.peso);

  return {
    itens: itens.sort((a, b) => b.peso - a.peso),
    clientes: [...clientes.values()].sort((a, b) => b.peso - a.peso),
    analisados: porCliente.size,
    porRegra,
    bloqueadas,
    desligadas,
    avaliados: ligados.length,
  };
}
