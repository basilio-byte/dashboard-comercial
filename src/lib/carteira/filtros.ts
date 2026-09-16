import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { nowInAppTz, ultimoMesFechado } from "@/lib/dates";
import { clientesComExcedente } from "@/lib/intel/horas";

/**
 * O FILTRO DA CARTEIRA — um só, para a tela e para o MCP.
 *
 * Pedido do Diego em 2026-09-16: *"Carteira — incluir espaço para filtros
 * (receita, plano, horas contratadas, horas disponíveis, estourou o pacote de
 * horas...) + possibilidade de mesclar filtros assim como no ClickUp (ex.:
 * filtrar por Plano X + Receita de maior para menor)"*.
 *
 * ⚠ Mesclar é o requisito, não um detalhe: todo campo aqui é opcional e todos
 * se acumulam num único `AND`. O exemplo dele — plano X mais receita
 * decrescente — é `{ planoConexaId, ordenarPor: "receita", direcao: "desc" }`.
 *
 * ⚠ **"Horas disponíveis" NÃO está aqui, e a ausência é deliberada.** O saldo
 * do pacote de horas vive em `recurringSales.packageId`, e `/packages` responde
 * 404 por permissão deste token — não existe caminho pela API. Um filtro que
 * aceitasse "horas disponíveis" teria de inventar o número ou devolver lista
 * vazia, e as duas coisas mentem. Em vez disso a função devolve `lacunas`, que
 * a tela imprime e o MCP entrega ao agente: o filtro que falta aparece como
 * lacuna declarada, com o motivo e de quem depende a solução.
 *
 * O que SUBSTITUI o pedido, com dado real:
 *  - `horasMin`/`horasMax` — horas CONTRATADAS (cota mensal do plano);
 *  - `semCota` — plano sem horas inclusas, que é o Litoral e não é zero hora;
 *  - `estourouCota` — quem paga hora por fora de forma recorrente, que é a
 *    pergunta comercial por trás de "estourou o pacote".
 */

export type OrdenarPor = "receita" | "nome" | "horas" | "variacao" | "contratoDesde";

export interface FiltroCarteira {
  busca?: string;
  /** Segmentos do perfil consolidado (derivados de contrato → plano → categoria). */
  segmentos?: string[];
  /** Unidade física, das categorias classificadas à mão. */
  unidade?: string;
  planoConexaId?: number;
  /** Categoria de serviço — mais largo que plano. */
  categoriaConexaId?: number;
  receitaMin?: number;
  receitaMax?: number;
  /** Horas CONTRATADAS por mês (cota do plano). Não é saldo. */
  horasMin?: number;
  horasMax?: number;
  /** Só quem tem contrato ativo com plano SEM horas inclusas (Litoral). */
  semCota?: boolean;
  comContratoAtivo?: boolean;
  /** Estoura a cota de horas com recorrência — o gatilho "extra". */
  estourouCota?: boolean;
  /** Por padrão inativos e bloqueados ficam de fora (gate de elegibilidade). */
  incluirInelegiveis?: boolean;
  /** Clientes sem contato registrado há N dias, ou nunca. */
  semContatoHaDias?: number;
  ordenarPor?: OrdenarPor;
  direcao?: "asc" | "desc";
  limite?: number;
  offset?: number;
}

export interface LinhaDaCarteira {
  customerConexaId: number;
  nome: string | null;
  ativo: boolean;
  bloqueado: boolean;
  segmentos: string[];
  receitaAno: number;
  receita12Meses: number;
  /** `null` = plano sem horas inclusas. NÃO é zero. */
  horasInclusasMes: number | null;
  temContratoAtivo: boolean;
  contratosAtivos: number;
  contratoDesde: string | null;
  variacaoUltimoMes: number | null;
  estouraCota: boolean;
  ultimoContatoEm: string | null;
  ultimoContatoQuem: string | null;
}

export interface ResultadoDaCarteira {
  itens: LinhaDaCarteira[];
  /** Quantos atendem ao filtro, antes da paginação. */
  total: number;
  /** Filtros pedidos que este sistema não sabe responder, e por quê. */
  lacunas: string[];
  /** O que atrapalhou sem impedir — ex.: excedente não avaliável. */
  avisos: string[];
  mesDaVariacao: string;
}

export const LACUNA_HORAS_DISPONIVEIS =
  "horas disponíveis (saldo do pacote): não é calculável — as horas do pacote vêm de " +
  "`recurringSales.packageId` e `/packages` responde 404 por permissão deste token. " +
  "Depende de liberação do admin do Conexa, não de desenvolvimento.";

export async function buscarCarteira(f: FiltroCarteira = {}): Promise<ResultadoDaCarteira> {
  const limite = Math.min(Math.max(f.limite ?? 50, 1), 500);
  const offset = Math.max(f.offset ?? 0, 0);
  const mesFechado = ultimoMesFechado();
  const avisos: string[] = [];

  const where: Prisma.CustomerProfileWhereInput = {};
  const eList: Prisma.CustomerProfileWhereInput[] = [];

  if (!f.incluirInelegiveis) {
    eList.push({ customer: { isActive: true, isBlocked: false } });
  }
  if (f.busca?.trim()) {
    const q = f.busca.trim();
    eList.push({
      customer: {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { tradeName: { contains: q, mode: "insensitive" } },
          { document: { contains: q } },
        ],
      },
    });
  }
  if (f.segmentos?.length) eList.push({ segmentos: { hasSome: f.segmentos } });
  if (f.receitaMin !== undefined) eList.push({ receitaAnoCorrente: { gte: f.receitaMin } });
  if (f.receitaMax !== undefined) eList.push({ receitaAnoCorrente: { lte: f.receitaMax } });
  if (f.comContratoAtivo !== undefined) eList.push({ temContratoAtivo: f.comContratoAtivo });

  // ⚠ `semCota` e `horasMin/Max` são mutuamente excludentes por natureza: o
  // primeiro pede `null`, os outros pedem número. Pedir os dois devolveria
  // vazio sem explicação — melhor dizer.
  if (f.semCota) {
    if (f.horasMin !== undefined || f.horasMax !== undefined) {
      avisos.push(
        '"sem cota" e faixa de horas contratadas não combinam: sem cota é ausência de cota, não uma quantidade. A faixa foi ignorada.',
      );
    }
    eList.push({ horasInclusasMes: null, temContratoAtivo: true });
  } else {
    if (f.horasMin !== undefined) eList.push({ horasInclusasMes: { gte: f.horasMin } });
    if (f.horasMax !== undefined) eList.push({ horasInclusasMes: { lte: f.horasMax } });
  }

  // ── Filtros que passam por contrato → plano → categoria ──────────────────
  const porContrato: Prisma.ContractWhereInput[] = [];
  if (f.planoConexaId !== undefined) porContrato.push({ planConexaId: f.planoConexaId });

  if (f.categoriaConexaId !== undefined || f.unidade) {
    let catIds: number[] = [];
    if (f.categoriaConexaId !== undefined) catIds = [f.categoriaConexaId];
    if (f.unidade) {
      const doUnidade = await prisma.categoriaClassificacao.findMany({
        where: { unidade: f.unidade },
        select: { serviceCategoryConexaId: true },
      });
      const ids = doUnidade.map((c) => c.serviceCategoryConexaId);
      catIds = catIds.length ? catIds.filter((c) => ids.includes(c)) : ids;
      if (!ids.length) {
        avisos.push(
          `nenhuma categoria está classificada com a unidade "${f.unidade}" — classifique-as na tela Gatilhos.`,
        );
      }
    }
    if (catIds.length) {
      const planosDaCat = await prisma.plan.findMany({
        where: { serviceCategoryConexaId: { in: catIds } },
        select: { conexaId: true },
      });
      porContrato.push({ planConexaId: { in: planosDaCat.map((p) => p.conexaId) } });
    } else {
      // Nenhuma categoria casou: o resultado é vazio, e dizer isso é melhor que
      // devolver a base inteira como se o filtro não existisse.
      porContrato.push({ planConexaId: { in: [] } });
    }
  }

  if (porContrato.length) {
    const contratos = await prisma.contract.findMany({
      where: { isActive: true, customerConexaId: { not: null }, AND: porContrato },
      select: { customerConexaId: true },
      distinct: ["customerConexaId"],
    });
    eList.push({
      customerConexaId: { in: contratos.map((c) => c.customerConexaId!) },
    });
  }

  // ── Excedente: exige a fila em lote ─────────────────────────────────────
  let idsQueEstouram: Set<number> | null = null;
  if (f.estourouCota !== undefined) {
    try {
      const fila = await clientesComExcedente(nowInAppTz());
      idsQueEstouram = new Set(fila.itens.map((i) => i.customerConexaId));
      eList.push(
        f.estourouCota
          ? { customerConexaId: { in: [...idsQueEstouram] } }
          : { customerConexaId: { notIn: [...idsQueEstouram] } },
      );
    } catch (err) {
      // ⚠ Não vira silêncio. Ignorar o filtro devolveria uma lista que parece
      // filtrada e não está — o pior resultado possível para quem confia nela.
      avisos.push(
        `o filtro "estourou a cota" não pôde ser aplicado: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // ── Contato ─────────────────────────────────────────────────────────────
  if (f.semContatoHaDias !== undefined) {
    const corte = new Date(Date.now() - f.semContatoHaDias * 86_400_000);
    eList.push({
      customer: { contatos: { none: { contatoEm: { gte: corte } } } },
    });
  }

  if (eList.length) where.AND = eList;

  const ordenarPor = f.ordenarPor ?? "receita";
  const direcao = f.direcao ?? (ordenarPor === "nome" ? "asc" : "desc");

  // ⚠ `variacao` não é coluna deste modelo: vive em CustomerMonthlyRevenue, por
  // mês. Ordenar por ela no banco exigiria uma view; ordenamos a PÁGINA em
  // memória e dizemos que é da página, para ninguém ler "os que mais caíram na
  // base" onde está escrito "os que mais caíram entre estes".
  const orderBy: Prisma.CustomerProfileOrderByWithRelationInput =
    ordenarPor === "nome"
      ? { customer: { name: direcao } }
      : ordenarPor === "horas"
        ? { horasInclusasMes: direcao }
        : ordenarPor === "contratoDesde"
          ? { contratoDesde: direcao }
          : { receitaAnoCorrente: direcao };

  const [total, perfis] = await Promise.all([
    prisma.customerProfile.count({ where }),
    prisma.customerProfile.findMany({
      where,
      orderBy,
      take: limite,
      skip: offset,
      select: {
        customerConexaId: true,
        receitaAnoCorrente: true,
        receita12Meses: true,
        segmentos: true,
        horasInclusasMes: true,
        temContratoAtivo: true,
        contratosAtivos: true,
        contratoDesde: true,
        customer: {
          select: {
            name: true,
            isActive: true,
            isBlocked: true,
            contatos: {
              orderBy: { contatoEm: "desc" },
              take: 1,
              select: { contatoEm: true, quem: true },
            },
          },
        },
      },
    }),
  ]);

  const ids = perfis.map((p) => p.customerConexaId);
  const variacoes = ids.length
    ? await prisma.customerMonthlyRevenue.findMany({
        where: { mesKey: mesFechado, customerConexaId: { in: ids } },
        select: { customerConexaId: true, variacaoPct: true },
      })
    : [];
  const varPor = new Map(variacoes.map((v) => [v.customerConexaId, v.variacaoPct]));

  // Excedente só é conhecido quando a fila foi calculada — se o filtro não
  // pediu, a coluna não afirma nada e vem `false` com a ressalva no aviso.
  if (idsQueEstouram === null && ids.length) {
    try {
      const fila = await clientesComExcedente(nowInAppTz());
      idsQueEstouram = new Set(fila.itens.map((i) => i.customerConexaId));
    } catch {
      idsQueEstouram = null;
    }
  }

  let itens: LinhaDaCarteira[] = perfis.map((p) => ({
    customerConexaId: p.customerConexaId,
    nome: p.customer?.name ?? null,
    ativo: p.customer?.isActive ?? true,
    bloqueado: p.customer?.isBlocked ?? false,
    segmentos: p.segmentos,
    receitaAno: Number(p.receitaAnoCorrente),
    receita12Meses: Number(p.receita12Meses),
    horasInclusasMes: p.horasInclusasMes === null ? null : Number(p.horasInclusasMes),
    temContratoAtivo: p.temContratoAtivo,
    contratosAtivos: p.contratosAtivos,
    contratoDesde: p.contratoDesde ? p.contratoDesde.toISOString().slice(0, 10) : null,
    variacaoUltimoMes: (() => {
      const v = varPor.get(p.customerConexaId);
      return v === null || v === undefined ? null : Number(v);
    })(),
    estouraCota: idsQueEstouram?.has(p.customerConexaId) ?? false,
    ultimoContatoEm: p.customer?.contatos[0]?.contatoEm.toISOString().slice(0, 10) ?? null,
    ultimoContatoQuem: p.customer?.contatos[0]?.quem ?? null,
  }));

  if (ordenarPor === "variacao") {
    const s = direcao === "asc" ? 1 : -1;
    itens = [...itens].sort((a, b) => {
      // Sem variação vai sempre para o fim: `null` é ausência de base de
      // comparação, não a menor queda do mundo.
      if (a.variacaoUltimoMes === null) return 1;
      if (b.variacaoUltimoMes === null) return -1;
      return s * (a.variacaoUltimoMes - b.variacaoUltimoMes);
    });
  }

  return {
    itens,
    total,
    lacunas: [LACUNA_HORAS_DISPONIVEIS],
    avisos,
    mesDaVariacao: mesFechado,
  };
}

/** As opções que a tela oferece nos seletores — vindas do dado, não escritas. */
export async function opcoesDeFiltro(): Promise<{
  segmentos: string[];
  unidades: string[];
  planos: Array<{ conexaId: number; nome: string; horasInclusasMes: number | null; contratos: number }>;
  categorias: Array<{ conexaId: number; nome: string }>;
}> {
  const [perfis, unidades, planos, categorias, contratosPorPlano] = await Promise.all([
    prisma.customerProfile.findMany({ select: { segmentos: true }, take: 5000 }),
    prisma.categoriaClassificacao.findMany({
      where: { unidade: { not: null } },
      select: { unidade: true },
      distinct: ["unidade"],
    }),
    prisma.plan.findMany({
      where: { isActive: true },
      select: { conexaId: true, name: true, horasInclusasMes: true },
      orderBy: { name: "asc" },
    }),
    prisma.serviceCategory.findMany({
      select: { conexaId: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.contract.groupBy({
      by: ["planConexaId"],
      where: { isActive: true },
      _count: true,
    }),
  ]);

  const usoPor = new Map(
    contratosPorPlano
      .filter((c) => c.planConexaId !== null)
      .map((c) => [c.planConexaId!, c._count]),
  );

  return {
    segmentos: [...new Set(perfis.flatMap((p) => p.segmentos))].sort(),
    unidades: unidades.map((u) => u.unidade!).sort(),
    // Só planos COM contrato ativo: um seletor com 300 planos mortos não é
    // filtro, é lista telefônica.
    planos: planos
      .filter((p) => (usoPor.get(p.conexaId) ?? 0) > 0)
      .map((p) => ({
        conexaId: p.conexaId,
        nome: p.name ?? `plano ${p.conexaId}`,
        horasInclusasMes: p.horasInclusasMes === null ? null : Number(p.horasInclusasMes),
        contratos: usoPor.get(p.conexaId) ?? 0,
      }))
      .sort((a, b) => b.contratos - a.contratos),
    categorias: categorias.map((c) => ({
      conexaId: c.conexaId,
      nome: c.name ?? `categoria ${c.conexaId}`,
    })),
  };
}
