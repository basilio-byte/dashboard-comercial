import { z } from "zod";
import { prisma } from "@/lib/db";
import { ferramenta } from "../tipos";
import { buscarCarteira, opcoesDeFiltro, LACUNA_HORAS_DISPONIVEIS } from "@/lib/carteira/filtros";
import { estadoDoEspelho } from "@/lib/intel/completude";
import { horasDoCliente } from "@/lib/intel/horas";
import { sinaisDoCliente } from "@/lib/regras/avaliar";
import { filaDeSinais } from "@/lib/regras/fila";
import { lerCategorias } from "@/lib/regras/segmentos";
import { ultimosMesesFechados, ultimoMesFechado } from "@/lib/dates";

/**
 * FERRAMENTAS DE LEITURA — o que o agente pode perguntar ao painel.
 *
 * ⚠ Toda descrição diz o que a ferramenta NÃO responde. É o que evita o agente
 * chamar a errada e apresentar um número fora de contexto: um modelo que só
 * sabe o que a ferramenta faz descobre os limites dela errando na frente do
 * usuário.
 */

const idCliente = z
  .number()
  .int()
  .describe("conexaId do cliente — o id do Conexa, que é a chave em todo o sistema.");

export const ferramentasDeConsulta = [
  ferramenta({
    nome: "estado_do_espelho",
    titulo: "Estado do espelho",
    descricao:
      "Completude do espelho local do Conexa, por entidade, e quais portões estão abertos. " +
      "CHAME ISTO ANTES de afirmar qualquer número derivado: enquanto uma entidade está incompleta, " +
      "receita e horas são lacuna declarada, não zero. Devolve também as últimas execuções de carga.",
    entrada: z.object({}),
    somenteLeitura: true,
    executar: async () => {
      const [espelho, runs, janelas] = await Promise.all([
        estadoDoEspelho(),
        prisma.syncRun.findMany({
          orderBy: { startedAt: "desc" },
          take: 10,
          select: {
            mode: true, entity: true, status: true, startedAt: true, finishedAt: true,
            requestsMade: true, recordsRead: true, recordsWrote: true, error: true,
          },
        }),
        prisma.syncWindow.groupBy({ by: ["entidade", "status"], _count: true }),
      ]);
      return {
        receitaConfiavel: espelho.receitaConfiavel,
        horasConfiavel: espelho.horasConfiavel,
        barramReceita: espelho.barramReceita,
        barramHoras: espelho.barramHoras,
        entidades: espelho.entidades,
        janelasPorEntidade: janelas.reduce<Record<string, Record<string, number>>>((acc, j) => {
          (acc[j.entidade] ??= {})[j.status] = j._count;
          return acc;
        }, {}),
        ultimasExecucoes: runs,
      };
    },
  }),

  ferramenta({
    nome: "listar_clientes",
    titulo: "Listar clientes (carteira)",
    descricao:
      "Lista clientes com filtros COMBINÁVEIS e ordenação — a mesma função que a tela Carteira usa. " +
      "Ex.: {planoConexaId: 123, ordenarPor: 'receita', direcao: 'desc'}. " +
      "Por padrão exclui inativos e bloqueados (gate de elegibilidade). " +
      "NÃO filtra por saldo/horas disponíveis: esse dado não existe (veja o campo `lacunas` do retorno). " +
      "'horasInclusasMes: null' significa plano SEM horas inclusas (Litoral), e não zero hora.",
    entrada: z.object({
      busca: z.string().optional().describe("nome, nome fantasia ou documento"),
      segmentos: z.array(z.string()).optional(),
      unidade: z.string().optional().describe("unidade física, das categorias classificadas"),
      planoConexaId: z.number().int().optional(),
      categoriaConexaId: z.number().int().optional(),
      receitaMin: z.number().optional(),
      receitaMax: z.number().optional(),
      horasMin: z.number().optional().describe("horas CONTRATADAS por mês, não saldo"),
      horasMax: z.number().optional(),
      semCota: z.boolean().optional().describe("plano sem horas inclusas (Litoral)"),
      comContratoAtivo: z.boolean().optional(),
      estourouCota: z.boolean().optional().describe("estoura a cota de horas com recorrência"),
      semContatoHaDias: z.number().int().optional(),
      incluirInelegiveis: z.boolean().optional(),
      ordenarPor: z.enum(["receita", "nome", "horas", "variacao", "contratoDesde"]).optional(),
      direcao: z.enum(["asc", "desc"]).optional(),
      limite: z.number().int().min(1).max(500).default(50),
      offset: z.number().int().min(0).default(0),
    }),
    somenteLeitura: true,
    executar: async (a) => buscarCarteira(a),
  }),

  ferramenta({
    nome: "opcoes_de_filtro",
    titulo: "Opções de filtro da carteira",
    descricao:
      "Os valores válidos para os filtros de listar_clientes: segmentos existentes, unidades " +
      "classificadas, planos COM contrato ativo e categorias de serviço. Chame antes de filtrar " +
      "por plano ou unidade, em vez de adivinhar ids.",
    entrada: z.object({}),
    somenteLeitura: true,
    executar: async () => opcoesDeFiltro(),
  }),

  ferramenta({
    nome: "cliente",
    titulo: "Ficha do cliente",
    descricao:
      "Tudo o que o painel sabe de um cliente: cadastro, contratos ativos com plano e cota, " +
      "receita mês a mês, consumo de horas por ciclo de contrato e contatos registrados. " +
      "Para os gatilhos avaliados use sinais_do_cliente.",
    entrada: z.object({
      customerConexaId: idCliente,
      mesesDeReceita: z.number().int().min(1).max(36).default(12),
    }),
    somenteLeitura: true,
    executar: async (a) => {
      const cliente = await prisma.customer.findUnique({
        where: { conexaId: a.customerConexaId },
        select: {
          conexaId: true, name: true, tradeName: true, document: true,
          isJuridicalPerson: true, isActive: true, isBlocked: true,
          city: true, state: true, createdAtConexa: true,
        },
      });
      if (!cliente) throw new Error(`Cliente ${a.customerConexaId} não existe no espelho.`);

      const meses = ultimosMesesFechados(a.mesesDeReceita);
      const [perfil, contratos, receita, contatos, horas] = await Promise.all([
        prisma.customerProfile.findUnique({ where: { customerConexaId: a.customerConexaId } }),
        prisma.contract.findMany({
          where: { customerConexaId: a.customerConexaId },
          orderBy: { startDate: "desc" },
          select: {
            conexaId: true, planConexaId: true, amount: true, paymentFrequency: true,
            startDate: true, endDate: true, isActive: true, dueDay: true, contractSummary: true,
          },
        }),
        prisma.customerMonthlyRevenue.findMany({
          where: { customerConexaId: a.customerConexaId, mesKey: { in: meses } },
          orderBy: { mesKey: "asc" },
          select: { mesKey: true, receita: true, cobrancas: true, variacaoPct: true, procedencia: true },
        }),
        prisma.contato.findMany({
          where: { customerConexaId: a.customerConexaId },
          orderBy: { contatoEm: "desc" },
          take: 20,
          select: {
            contatoEm: true, quem: true, regra: true, resultado: true, nota: true,
            agente: { select: { id: true, nome: true } },
          },
        }),
        horasDoCliente(a.customerConexaId).catch((e) => ({ erro: String(e) })),
      ]);

      const planoIds = [...new Set(contratos.map((c) => c.planConexaId).filter((x): x is number => x !== null))];
      const planos = planoIds.length
        ? await prisma.plan.findMany({
            where: { conexaId: { in: planoIds } },
            select: { conexaId: true, name: true, horasInclusasMes: true, serviceCategoryConexaId: true },
          })
        : [];

      return {
        cliente,
        perfil,
        contratos,
        planos,
        receitaMensal: receita,
        horas,
        contatos,
        lacunasConhecidas: [LACUNA_HORAS_DISPONIVEIS],
      };
    },
  }),

  ferramenta({
    nome: "sinais_do_cliente",
    titulo: "Sinais automáticos de um cliente",
    descricao:
      "Avalia TODOS os gatilhos configurados contra os dados deste cliente, agora. " +
      "Cada sinal volta com um dos quatro estados do documento do Diego: ATIVO, NAO_APLICAVEL, " +
      "DADO_INDISPONIVEL ou AMBIGUO — e `desligado: true` quando o gatilho está desligado na configuração, " +
      "que NÃO é uma conclusão sobre o cliente. AMBIGUO não é 'talvez': é o sistema recusando afirmar. " +
      "Isto NÃO dispara nada: não cria task nem mensagem.",
    entrada: z.object({ customerConexaId: idCliente }),
    somenteLeitura: true,
    executar: async (a) => {
      const sinais = await sinaisDoCliente(a.customerConexaId);
      return {
        customerConexaId: a.customerConexaId,
        sinais,
        resumo: {
          ativos: sinais.filter((s) => s.estado === "ATIVO").length,
          ambiguos: sinais.filter((s) => s.estado === "AMBIGUO").length,
          indisponiveis: sinais.filter((s) => s.estado === "DADO_INDISPONIVEL").length,
          desligados: sinais.filter((s) => s.desligado).length,
        },
      };
    },
  }),

  ferramenta({
    nome: "fila_de_sinais",
    titulo: "Fila do Radar",
    descricao:
      "A fila de quem procurar hoje: todos os gatilhos ligados avaliados em LOTE sobre a base " +
      "elegível inteira, agrupados por cliente. É o que a tela Radar mostra. " +
      "Leia `bloqueadas` e `desligadas` antes de concluir qualquer coisa de uma fila curta: " +
      "fila vazia com gatilhos bloqueados não significa 'ninguém tem oportunidade'.",
    entrada: z.object({
      regras: z.array(z.string()).optional().describe('filtra por código de gatilho, ex.: ["4","8"]'),
      familia: z
        .enum(["MARCO_CONTRATO", "TENDENCIA", "USO_SEM_COTA", "PRIMEIRO_EVENTO", "EVENTO_EM_SEGMENTO", "EXCEDENTE", "SALDO_COTA"])
        .optional(),
      semContatoHaDias: z
        .number()
        .int()
        .optional()
        .describe("só clientes sem contato registrado há N dias (ou nunca)"),
      receitaMin: z.number().optional(),
      limite: z.number().int().min(1).max(500).default(50),
    }),
    somenteLeitura: true,
    executar: async (a) => {
      const fila = await filaDeSinais();
      let clientes = fila.clientes;

      if (a.regras?.length) {
        const set = new Set(a.regras);
        clientes = clientes
          .map((c) => ({ ...c, sinais: c.sinais.filter((s) => set.has(s.regra)) }))
          .filter((c) => c.sinais.length > 0);
      }
      if (a.familia) {
        clientes = clientes
          .map((c) => ({ ...c, sinais: c.sinais.filter((s) => s.familia === a.familia) }))
          .filter((c) => c.sinais.length > 0);
      }
      if (a.receitaMin !== undefined) {
        clientes = clientes.filter((c) => c.receitaAno >= a.receitaMin!);
      }
      if (a.semContatoHaDias !== undefined) {
        const corte = Date.now() - a.semContatoHaDias * 86_400_000;
        clientes = clientes.filter(
          (c) => !c.ultimoContato || c.ultimoContato.contatoEm.getTime() < corte,
        );
      }

      return {
        clientes: clientes.slice(0, a.limite),
        totalDeClientes: clientes.length,
        totalDeSinais: clientes.reduce((n, c) => n + c.sinais.length, 0),
        analisados: fila.analisados,
        gatilhosAvaliados: fila.avaliados,
        porRegra: fila.porRegra,
        bloqueadas: fila.bloqueadas,
        desligadas: fila.desligadas,
      };
    },
  }),

  ferramenta({
    nome: "receita",
    titulo: "Receita",
    descricao:
      "Receita por mês, no regime de EMISSÃO e com currentAmount (com juros/multa) — a mesma régua " +
      "do dashboard financeiro. Cobrança cancelada e renegociada ficam de fora. " +
      "Sem `customerConexaId` devolve o total da base; com ele, a série do cliente. " +
      "Só meses FECHADOS: o mês em curso está pela metade e faria tudo parecer em queda.",
    entrada: z.object({
      customerConexaId: idCliente.optional(),
      meses: z.number().int().min(1).max(36).default(12),
      topClientes: z.number().int().min(0).max(100).default(0)
        .describe("também devolve os N maiores clientes do período"),
    }),
    somenteLeitura: true,
    executar: async (a) => {
      const meses = ultimosMesesFechados(a.meses);
      const espelho = await estadoDoEspelho();

      const linhas = await prisma.customerMonthlyRevenue.groupBy({
        by: ["mesKey"],
        where: {
          mesKey: { in: meses },
          ...(a.customerConexaId ? { customerConexaId: a.customerConexaId } : {}),
        },
        _sum: { receita: true },
        _count: true,
        orderBy: { mesKey: "asc" },
      });

      const top = a.topClientes
        ? await prisma.customerMonthlyRevenue.groupBy({
            by: ["customerConexaId"],
            where: { mesKey: { in: meses } },
            _sum: { receita: true },
            orderBy: { _sum: { receita: "desc" } },
            take: a.topClientes,
          })
        : [];
      const nomes = top.length
        ? await prisma.customer.findMany({
            where: { conexaId: { in: top.map((t) => t.customerConexaId) } },
            select: { conexaId: true, name: true },
          })
        : [];
      const nomePor = new Map(nomes.map((n) => [n.conexaId, n.name]));

      return {
        procedencia: espelho.receitaConfiavel ? "DERIVADO" : "INDISPONIVEL",
        avisoDeCompletude: espelho.receitaConfiavel
          ? null
          : `espelho incompleto (${espelho.barramReceita.join(", ")}) — estes números são parciais e não valem como fato`,
        regime: "emissão (createdAt do Conexa em America/Fortaleza), campo currentAmount",
        meses: linhas.map((l) => ({
          mesKey: l.mesKey,
          receita: l._sum.receita?.toString() ?? "0",
          clientes: l._count,
        })),
        topClientes: top.map((t) => ({
          customerConexaId: t.customerConexaId,
          nome: nomePor.get(t.customerConexaId) ?? null,
          receita: t._sum.receita?.toString() ?? "0",
        })),
        ultimoMesFechado: ultimoMesFechado(),
      };
    },
  }),

  ferramenta({
    nome: "horas_do_cliente",
    titulo: "Consumo de horas",
    descricao:
      "Consumo de horas POR CONTRATO e por ciclo (o ciclo é o aniversário mensal do contrato, " +
      "não 30 dias, e não acumula). Diz se o cliente estoura a cota e quanto paga por fora. " +
      "NÃO devolve saldo de pacote comprado — esse dado é 404 por permissão. " +
      "Quando o cliente tem mais de um contrato com cota, a atribuição é AMBÍGUA e os números " +
      "por contrato não são conclusivos.",
    entrada: z.object({ customerConexaId: idCliente }),
    somenteLeitura: true,
    executar: async (a) => {
      const h = await horasDoCliente(a.customerConexaId);
      return { ...h, lacuna: LACUNA_HORAS_DISPONIVEIS };
    },
  }),

  ferramenta({
    nome: "catalogo",
    titulo: "Catálogo do Conexa",
    descricao:
      "Planos, produtos e categorias de serviço espelhados do Conexa, com a classificação de " +
      "segmento de cada categoria. O TIER do Endereço Fiscal sai da cota do plano " +
      "(Litoral = sem cota, Batial = 2h, Abissal = 8h), NUNCA do nome do produto.",
    entrada: z.object({
      tipo: z.enum(["planos", "produtos", "categorias", "tudo"]).default("tudo"),
      busca: z.string().optional(),
      apenasAtivos: z.boolean().default(true),
      limite: z.number().int().min(1).max(500).default(100),
    }),
    somenteLeitura: true,
    executar: async (a) => {
      const nome = a.busca ? { contains: a.busca, mode: "insensitive" as const } : undefined;
      const quer = (t: string) => a.tipo === "tudo" || a.tipo === t;
      return {
        planos: quer("planos")
          ? await prisma.plan.findMany({
              where: { ...(a.apenasAtivos ? { isActive: true } : {}), ...(nome ? { name: nome } : {}) },
              take: a.limite,
              orderBy: { name: "asc" },
              select: {
                conexaId: true, name: true, horasInclusasMes: true,
                serviceCategoryConexaId: true, isActive: true,
              },
            })
          : undefined,
        produtos: quer("produtos")
          ? await prisma.product.findMany({
              where: { ...(a.apenasAtivos ? { isActive: true } : {}), ...(nome ? { name: nome } : {}) },
              take: a.limite,
              orderBy: { name: "asc" },
              select: {
                conexaId: true, name: true, price: true,
                serviceCategoryConexaId: true, isActive: true,
              },
            })
          : undefined,
        categorias: quer("categorias") ? await lerCategorias() : undefined,
      };
    },
  }),

  ferramenta({
    nome: "listar_contatos",
    titulo: "Contatos registrados",
    descricao:
      "O histórico de contatos que os vendedores registraram à mão. É o que impede a fila de " +
      "reofertar ao mesmo cliente — resultado RECUSOU é o que mais importa. " +
      "Não é histórico de disparo: a camada de disparo não existe.",
    entrada: z.object({
      customerConexaId: idCliente.optional(),
      agenteId: z.string().optional(),
      resultado: z.enum(["FALOU", "SEM_RESPOSTA", "INTERESSADO", "RECUSOU", "FECHOU"]).optional(),
      desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      limite: z.number().int().min(1).max(500).default(50),
    }),
    somenteLeitura: true,
    executar: async (a) => {
      const contatos = await prisma.contato.findMany({
        where: {
          ...(a.customerConexaId ? { customerConexaId: a.customerConexaId } : {}),
          ...(a.agenteId ? { agenteId: a.agenteId } : {}),
          ...(a.resultado ? { resultado: a.resultado } : {}),
          ...(a.desde ? { contatoEm: { gte: new Date(`${a.desde}T00:00:00.000Z`) } } : {}),
        },
        orderBy: { contatoEm: "desc" },
        take: a.limite,
        select: {
          id: true, customerConexaId: true, contatoEm: true, quem: true, regra: true,
          resultado: true, nota: true, registradoPor: true, registradoEm: true,
          agente: { select: { id: true, nome: true } },
          customer: { select: { name: true } },
        },
      });
      return { contatos, total: contatos.length };
    },
  }),
];
