import { z } from "zod";
import { prisma } from "@/lib/db";
import { ferramenta } from "../tipos";
import { getEnv, conexaConfigurado } from "@/lib/env";
import { syncDimensoes } from "@/lib/conexa/sync";
import { cargaHistorica, sincronizarIncremental } from "@/lib/conexa/sync-janelas";
import type { Entidade } from "@/lib/conexa/janelas";
import { consolidarTudo } from "@/lib/intel/consolidar";
import { reconciliarMes } from "@/lib/intel/reconciliar";
import {
  conexaFetch,
  requisicoesFeitas,
  respostas429,
  ultimoRateLimitObservado,
  type Query,
} from "@/lib/conexa/client";
import { keyToUtcDate, todayKey } from "@/lib/dates";
import { registrarMudanca } from "@/lib/regras/config";

/**
 * FERRAMENTAS DE OPERAÇÃO — o que muda o estado do sistema.
 *
 * ⚠ Nada aqui fala com o CLIENTE. Não existe ferramenta que crie task no
 * ClickUp nem mensagem no Chatwoot, e a ausência é estrutural: a camada de
 * disparo não existe no código. Se um dia existir, ela entra atrás de dry-run e
 * de allowlist de destino — nunca como ferramenta de MCP de uso geral.
 *
 * ⚠ As cargas consomem o RATE LIMIT do Conexa, que é de 60 requisições por
 * minuto e compartilhado. Um agente que chama `sincronizar` em laço mata a
 * carga agendada. Por isso as descrições dizem o custo em requisições, e a
 * carga histórica tem orçamento de tempo em vez de "vai até acabar".
 */

export const ferramentasDeOperacao = [
  ferramenta({
    nome: "sincronizar",
    titulo: "Sincronizar com o Conexa",
    descricao:
      "Roda uma carga do Conexa. MODOS: 'dimensions' (cadastros: empresas, categorias, planos, " +
      "produtos — barato), 'incremental' (o que mudou recentemente), 'backfill' (histórico por " +
      "janela mensal, com orçamento de tempo), 'intelligence' (só recalcula os derivados locais, " +
      "sem tocar na API). " +
      "⚠ CUSTA REQUISIÇÕES do rate limit compartilhado (60/min, sem header de saldo). " +
      "Não chame em laço. Para só recalcular receita e perfis, use 'intelligence', que é grátis.",
    entrada: z.object({
      modo: z.enum(["dimensions", "incremental", "backfill", "intelligence"]),
      entidades: z
        .array(z.enum(["customers", "contracts", "charges", "sales", "bookings"]))
        .optional()
        .describe("restringe a carga; omitido = todas"),
      minutos: z
        .number()
        .min(0.5)
        .max(4.5)
        .default(2)
        .describe("orçamento de tempo do backfill, em minutos"),
      mesesParaTras: z
        .number()
        .int()
        .min(0)
        .max(24)
        .optional()
        .describe(
          "só no modo incremental: quantos meses revarrer. Revarrer uma janela inteira também remove do " +
            "espelho o que foi APAGADO no Conexa (confirmado por busca por id). Custa ~1–5 requisições por " +
            "mês por entidade — restrinja `entidades`.",
        ),
    }),
    somenteLeitura: false,
    mundoAberto: true,
    executar: async (a) => {
      if (a.modo !== "intelligence" && !conexaConfigurado()) {
        throw new Error(
          "CONEXA_API_TOKEN não está configurado — só o modo 'intelligence' funciona sem ele.",
        );
      }
      switch (a.modo) {
        case "dimensions":
          return syncDimensoes();
        case "incremental":
          return sincronizarIncremental({
            entidades: a.entidades as Entidade[] | undefined,
            ...(a.mesesParaTras !== undefined
              ? { mesesParaTras: a.mesesParaTras, profundidade: "profunda" as const }
              : {}),
          });
        case "backfill":
          return cargaHistorica({
            entidades: a.entidades as Entidade[] | undefined,
            orcamentoMs: a.minutos * 60_000,
          });
        case "intelligence":
          return consolidarTudo();
      }
    },
  }),

  ferramenta({
    nome: "reconciliar_mes",
    titulo: "Conferir um mês contra o Conexa",
    descricao:
      "Compara a receita local de um mês com a do Conexa e grava o resultado no histórico de " +
      "Confiança. Veredicto: BATE, DIVERGE ou NADA_A_CONFERIR. " +
      "⚠ A janela é por VENCIMENTO — a API não filtra por emissão, que é o regime da receita. " +
      "Custa dezenas de requisições; não rode para doze meses em sequência.",
    entrada: z.object({
      mesKey: z.string().regex(/^\d{4}-\d{2}$/).describe("aaaa-mm"),
    }),
    somenteLeitura: false,
    mundoAberto: true,
    executar: async (a, ctx) => {
      const r = await reconciliarMes(a.mesKey);
      try {
        await prisma.reconciliacao.create({
          data: {
            mesKey: r.mesKey,
            janela: r.janela,
            executadaPor: ctx.quem,
            veredicto: r.veredicto,
            localTotal: r.localTotal,
            localContagem: r.localContagem,
            remotoTotal: r.remotoTotal,
            remotoContagem: r.remotoContagem,
            diferenca: r.diferenca,
            divergencias: r.divergencias.length,
            detalhe: r.divergencias.length ? (r.divergencias as never) : undefined,
            requisicoes: r.requisicoes,
            observacao: r.observacao ?? null,
          },
        });
      } catch (err) {
        // O número na tela é o produto; o histórico é o bônus. Mesma escolha
        // que `acaoReconciliar` faz na UI.
        console.error("[mcp] falhou ao gravar a reconciliação:", err);
      }
      return r;
    },
  }),

  ferramenta({
    nome: "registrar_contato",
    titulo: "Registrar contato com cliente",
    descricao:
      "Registra que alguém FALOU com o cliente — é o que impede a fila de repetir o mesmo nome " +
      "todo dia. Resultado RECUSOU é o mais importante: é o que vira supressão. " +
      "Passe `agenteId` quando quem falou está no cadastro de agentes; `quem` é o nome exibível " +
      "e continua obrigatório. Data no futuro é recusada.",
    entrada: z.object({
      customerConexaId: z.number().int(),
      quem: z.string().min(1).describe("nome de quem falou com o cliente"),
      resultado: z.enum(["FALOU", "SEM_RESPOSTA", "INTERESSADO", "RECUSOU", "FECHOU"]),
      agenteId: z.string().optional(),
      contatoEm: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe("aaaa-mm-dd; padrão: hoje"),
      regra: z.string().optional().describe('qual sinal motivou: "4", "extra", "métrica"...'),
      nota: z.string().optional(),
    }),
    somenteLeitura: false,
    executar: async (a, ctx) => {
      const hoje = keyToUtcDate(todayKey());
      const contatoEm = a.contatoEm ? keyToUtcDate(a.contatoEm) : hoje;
      if (Number.isNaN(contatoEm.getTime())) throw new Error("Data inválida.");
      // ⚠ Futuro é erro de digitação, não registro: um contato que "vai
      // acontecer" entraria na fila como se o cliente já tivesse sido
      // procurado, e silenciaria o sinal.
      if (contatoEm > hoje) throw new Error("A data do contato não pode ser no futuro.");

      if (a.agenteId) {
        const existe = await prisma.agente.findUnique({ where: { id: a.agenteId } });
        if (!existe) throw new Error(`Agente ${a.agenteId} não existe. Use agentes_listar.`);
      }

      try {
        return await prisma.contato.create({
          data: {
            customerConexaId: a.customerConexaId,
            contatoEm,
            quem: a.quem,
            agenteId: a.agenteId ?? null,
            resultado: a.resultado,
            regra: a.regra ?? null,
            nota: a.nota ?? null,
            registradoPor: ctx.quem,
          },
        });
      } catch (err) {
        if (err instanceof Error && err.message.includes("Foreign key")) {
          throw new Error(`Cliente ${a.customerConexaId} não existe no espelho.`);
        }
        throw err;
      }
    },
  }),

  ferramenta({
    nome: "conexa_get",
    titulo: "Consultar a API do Conexa (leitura)",
    descricao:
      "GET direto num recurso da API v2 do Conexa, para EXPLORAÇÃO durante o desenvolvimento — " +
      "descobrir o formato de um endpoint, conferir um registro, testar uma permissão. " +
      "⚠ Só GET, e passa pelo limitador de taxa do projeto. " +
      "⚠ Três sintaxes de query devolvem 400 se erradas: array vai como `campo[]`, booleano vai " +
      "como 1/0, data vai com offset. " +
      "⚠ A API NÃO É ORDENADA: offset 0 não é o registro mais antigo. Para varrer, use janela " +
      "temporal, não paginação. Endpoints conhecidos como 404 por permissão: /packages, /sellers.",
    entrada: z.object({
      recurso: z.string().min(1).describe('ex.: "customers", "contracts", "products", "customer/123"'),
      query: z.record(z.any()).default({}).describe("parâmetros de query"),
    }),
    somenteLeitura: true,
    mundoAberto: true,
    executar: async (a) => {
      if (!conexaConfigurado()) throw new Error("CONEXA_API_TOKEN não está configurado.");
      const recurso = a.recurso.replace(/^\/+/, "");
      // ⚠ O query vai DENTRO de `{ query }`. Passado como segundo argumento cru,
      // ele caía no lugar das OPÇÕES de `conexaFetch` e era descartado em
      // silêncio: todo filtro era ignorado e a ferramenta devolvia as 20
      // primeiras linhas da base como se fossem a resposta. O cast para
      // `Record<string, never>` escondia o erro de tipo. Achado em 2026-09-18,
      // ao testar `id[]` — `limit: 2` devolvia 20.
      const dados = await conexaFetch<unknown>(recurso, { query: a.query as Query });
      return {
        recurso,
        dados,
        consumo: {
          requisicoesNestaInstancia: requisicoesFeitas(),
          ultimoRateLimit: ultimoRateLimitObservado(),
          respostas429: respostas429(),
          aviso:
            "o limite de 60 req/min é compartilhado com a carga agendada — não chame em laço",
        },
      };
    },
  }),

  ferramenta({
    nome: "consulta_sql",
    titulo: "SQL somente leitura",
    descricao:
      "Roda um SELECT no banco do painel, para perguntas que nenhuma outra ferramenta responde. " +
      "⚠ SOMENTE LEITURA, imposto de duas formas: a consulta roda numa transação " +
      "READ ONLY do Postgres e é recusada se não começar com SELECT ou WITH. " +
      "O resultado é limitado por `maxLinhas`. Use esquema_do_banco para os nomes de tabela — " +
      "eles têm prefixo (dim_, fact_, intel_) e não são os nomes dos modelos Prisma.",
    entrada: z.object({
      sql: z.string().min(1),
      maxLinhas: z.number().int().min(1).max(1000).default(100),
    }),
    somenteLeitura: true,
    executar: async (a) => {
      const sql = a.sql.trim().replace(/;\s*$/, "");
      if (!/^\s*(select|with)\b/i.test(sql)) {
        throw new Error("Só SELECT e WITH são aceitos aqui.");
      }
      if (/;/.test(sql)) {
        throw new Error("Uma consulta por chamada — ponto e vírgula no meio não é aceito.");
      }

      // ⚠ O filtro acima é conveniência; a garantia é a transação READ ONLY.
      // Confiar só em expressão regular contra SQL é a aposta que se perde:
      // uma função que escreve cabe dentro de um SELECT.
      const linhas = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        return tx.$queryRawUnsafe<Record<string, unknown>[]>(
          `SELECT * FROM (${sql}) AS _consulta_mcp LIMIT ${a.maxLinhas}`,
        );
      });

      return {
        linhas,
        contagem: linhas.length,
        truncado: linhas.length === a.maxLinhas,
      };
    },
  }),

  ferramenta({
    nome: "esquema_do_banco",
    titulo: "Esquema do banco",
    descricao:
      "Tabelas e colunas do banco do painel, para montar consultas em consulta_sql. " +
      "Convenções: dim_ são cadastros espelhados, fact_ são fatos, intel_ são derivados nossos. " +
      "Dinheiro é Decimal(14,2), nunca float. Toda entidade do Conexa tem conexaId e raw.",
    entrada: z.object({
      tabela: z.string().optional().describe("filtra por nome; omitido = todas"),
    }),
    somenteLeitura: true,
    executar: async (a) => {
      const colunas = await prisma.$queryRawUnsafe<
        Array<{ table_name: string; column_name: string; data_type: string; is_nullable: string }>
      >(
        `SELECT table_name, column_name, data_type, is_nullable
         FROM information_schema.columns
         WHERE table_schema = 'public'
         ${a.tabela ? "AND table_name ILIKE $1" : ""}
         ORDER BY table_name, ordinal_position`,
        ...(a.tabela ? [`%${a.tabela}%`] : []),
      );
      const tabelas: Record<string, Array<{ coluna: string; tipo: string; nulo: boolean }>> = {};
      for (const c of colunas) {
        (tabelas[c.table_name] ??= []).push({
          coluna: c.column_name,
          tipo: c.data_type,
          nulo: c.is_nullable === "YES",
        });
      }
      return { tabelas };
    },
  }),

  ferramenta({
    nome: "diagnostico",
    titulo: "Diagnóstico da plataforma",
    descricao:
      "Visão geral de saúde: contagens por tabela, estado dos agendadores, configuração dos canais " +
      "de disparo e consumo recente do rate limit do Conexa. Primeira chamada útil quando algo " +
      "'parou de funcionar' — normalmente é agendador desligado ou espelho incompleto.",
    entrada: z.object({}),
    somenteLeitura: true,
    executar: async () => {
      const env = getEnv();
      const [
        clientes, contratos, cobrancas, vendas, reservas, perfis, contatos,
        agentes, gatilhos, categorias, runs,
      ] = await Promise.all([
        prisma.customer.count(),
        prisma.contract.count(),
        prisma.charge.count(),
        prisma.sale.count(),
        prisma.roomBooking.count(),
        prisma.customerProfile.count(),
        prisma.contato.count(),
        prisma.agente.count(),
        prisma.gatilho.count(),
        prisma.categoriaClassificacao.count(),
        prisma.syncRun.findMany({
          where: { status: "RUNNING" },
          select: { id: true, mode: true, entity: true, startedAt: true, heartbeatAt: true },
        }),
      ]);

      return {
        contagens: {
          clientes, contratos, cobrancas, vendas, reservas,
          perfisConsolidados: perfis, contatos,
          agentesCadastrados: agentes,
          gatilhosEditados: gatilhos,
          categoriasClassificadas: categorias,
        },
        agendadores: {
          sync: env.SYNC_SCHEDULER,
          inteligencia: env.INTEL_SCHEDULER,
        },
        disparo: {
          // ⚠ Todos os defaults fecham (ADR-0004). "off" aqui é o estado
          // correto enquanto a camada de disparo não existe.
          killSwitch: env.NOTIFICADOR,
          modo: env.NOTIFICADOR_MODO,
          clickup: env.CLICKUP_ENABLED,
          chatwoot: env.CHATWOOT_ENABLED,
          observacao: "a camada de disparo não está implementada — nada dispara, com ou sem estes toggles",
        },
        conexa: {
          configurado: conexaConfigurado(),
          tetoPorMinuto: env.CONEXA_RATE_LIMIT_PER_MIN,
          requisicoesNestaInstancia: requisicoesFeitas(),
          ultimoRateLimit: ultimoRateLimitObservado(),
          respostas429: respostas429(),
        },
        execucoesEmAndamento: runs,
        fuso: env.APP_TIMEZONE,
      };
    },
  }),

  ferramenta({
    nome: "anotar",
    titulo: "Anotar no histórico",
    descricao:
      "Grava uma observação no histórico de mudanças de configuração, sem alterar nada. " +
      "Use para deixar registrado por que uma alteração foi feita, ou o que foi investigado — " +
      "o painel não tem outro lugar para memória de decisão operacional.",
    entrada: z.object({
      assunto: z.string().min(1).describe("a que se refere: um código de gatilho, um id, um tema"),
      texto: z.string().min(1),
    }),
    somenteLeitura: false,
    executar: async (a, ctx) => {
      await registrarMudanca({
        entidade: "nota",
        chave: a.assunto,
        acao: "criou",
        depois: { texto: a.texto },
        quem: ctx.quem,
        origem: ctx.origem,
      });
      return { anotado: true, assunto: a.assunto };
    },
  }),
];
