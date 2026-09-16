import { z } from "zod";
import { prisma } from "@/lib/db";
import { ferramenta } from "../tipos";
import { FAMILIAS, paramsPorFamilia } from "@/lib/regras/catalogo";
import { paraJsonSchema } from "../esquema";
import {
  carregarGatilhos,
  criarGatilho,
  removerGatilho,
  restaurarGatilho,
  salvarGatilho,
} from "@/lib/regras/config";
import {
  classificarCategoria,
  lerCategorias,
  limparClassificacao,
  REGRAS_DO_SEGMENTO,
  SEGMENTOS,
} from "@/lib/regras/segmentos";
import {
  atualizarAgente,
  criarAgente,
  listarAgentes,
  removerAgente,
} from "@/lib/operacao/agentes";

/**
 * FERRAMENTAS DE CONFIGURAÇÃO — as três coisas que o Diego pediu para editar.
 *
 * ⚠ Toda escrita daqui grava em `mudancas_de_config` com `origem: "MCP"`. Não é
 * zelo de auditoria: quando um agente e uma pessoa mexem na mesma configuração,
 * "quem desligou a regra 8?" precisa ter resposta, e "foi um agente" é uma
 * resposta diferente de "foi o Diego".
 */

const familia = z.enum(FAMILIAS as [string, ...string[]]);

export const ferramentasDeConfiguracao = [
  // ── Gatilhos ────────────────────────────────────────────────────────────
  ferramenta({
    nome: "gatilhos_listar",
    titulo: "Listar gatilhos",
    descricao:
      "Todos os gatilhos com a configuração VIGENTE: ligado/desligado, limiares, oferta e peso. " +
      "`origemDaConfig: 'PADRAO'` significa que ninguém editou e ele usa o valor de fábrica. " +
      "`bloqueio` não nulo é estado do mundo (permissão da API), e ligar não resolve. " +
      "Com `incluirEsquemas`, devolve também o JSON Schema dos parâmetros de cada família — " +
      "chame assim antes de editar params, para não inventar nome de campo.",
    entrada: z.object({
      incluirEsquemas: z.boolean().default(false),
    }),
    somenteLeitura: true,
    executar: async (a) => {
      const g = await carregarGatilhos();
      return {
        gatilhos: g.todos,
        editados: g.editados,
        familias: FAMILIAS,
        esquemasDeParametros: a.incluirEsquemas
          ? Object.fromEntries(
              FAMILIAS.map((f) => [f, paraJsonSchema(paramsPorFamilia[f])]),
            )
          : undefined,
      };
    },
  }),

  ferramenta({
    nome: "gatilho_atualizar",
    titulo: "Editar gatilho",
    descricao:
      "Liga/desliga um gatilho ou muda os limiares, a oferta, o peso e a nota. " +
      "A FAMÍLIA não é editável: trocá-la mudaria o significado de um código já gravado no " +
      "histórico de contatos. Só os campos enviados mudam. " +
      "Mudar limiar NÃO redispara histórico — o motor avalia o estado de hoje. " +
      "Consulte gatilhos_listar com incluirEsquemas antes de mexer em `params`.",
    entrada: z.object({
      codigo: z.string().describe('"1".."10", "extra", "métrica" ou o código de um gatilho criado aqui'),
      ativo: z.boolean().optional(),
      nome: z.string().optional(),
      oferta: z.string().optional(),
      condicao: z.string().optional(),
      params: z.record(z.any()).optional().describe("limiares da família; validados antes de gravar"),
      peso: z.number().int().min(0).max(1000).optional(),
      nota: z.string().optional(),
    }),
    somenteLeitura: false,
    idempotente: true,
    executar: async (a, ctx) => {
      const { codigo, ...edicao } = a;
      return salvarGatilho(codigo, edicao, { quem: ctx.quem, origem: ctx.origem });
    },
  }),

  ferramenta({
    nome: "gatilho_criar",
    titulo: "Criar gatilho",
    descricao:
      "Cria um gatilho novo escolhendo uma das FAMÍLIAS que o código sabe avaliar e ajustando os " +
      "parâmetros dela. Ex.: 'avisar quando a sala privativa fizer 3 meses' é " +
      "{familia: 'MARCO_CONTRATO', params: {meses: 3, segmento: 'SALA_PRIVATIVA'}}. " +
      "NÃO cria lógica nova: uma pergunta que nenhuma família faz precisa de função pura testada, " +
      "não de linha de tabela. O gatilho novo passa a aparecer no Radar e na ficha do cliente.",
    entrada: z.object({
      nome: z.string().min(1),
      familia,
      oferta: z.string().min(1).describe("o que ofertar quando disparar"),
      condicao: z.string().optional().describe("a condição em português, para a tela"),
      params: z.record(z.any()).optional(),
      peso: z.number().int().min(0).max(1000).optional(),
      ativo: z.boolean().default(true),
      nota: z.string().optional(),
      codigo: z.string().optional().describe("código legível; gerado se omitido"),
    }),
    somenteLeitura: false,
    executar: async (a, ctx) =>
      criarGatilho(a as Parameters<typeof criarGatilho>[0], { quem: ctx.quem, origem: ctx.origem }),
  }),

  ferramenta({
    nome: "gatilho_remover",
    titulo: "Remover gatilho",
    descricao:
      "Remove um gatilho CRIADO aqui dentro. Gatilho nativo (as 12 regras do documento) não pode " +
      "ser removido — desligue-o com gatilho_atualizar. Remover órfã os contatos que registram " +
      "tê-lo usado como motivo.",
    entrada: z.object({ codigo: z.string() }),
    somenteLeitura: false,
    destrutiva: true,
    executar: async (a, ctx) => {
      await removerGatilho(a.codigo, { quem: ctx.quem, origem: ctx.origem });
      return { removido: a.codigo };
    },
  }),

  ferramenta({
    nome: "gatilho_restaurar",
    titulo: "Restaurar gatilho de fábrica",
    descricao:
      "Descarta as edições de um gatilho nativo e volta aos valores do catálogo. " +
      "Use quando uma alteração de limiar produziu fila demais ou de menos.",
    entrada: z.object({ codigo: z.string() }),
    somenteLeitura: false,
    idempotente: true,
    executar: async (a, ctx) => restaurarGatilho(a.codigo, { quem: ctx.quem, origem: ctx.origem }),
  }),

  // ── Agentes ─────────────────────────────────────────────────────────────
  ferramenta({
    nome: "agentes_listar",
    titulo: "Listar agentes",
    descricao:
      "O cadastro de quem usa a ferramenta (Diego, Guilherme...), com quantos contatos cada um " +
      "registrou. NÃO é o vendedor responsável do Conexa: aquele não é resolvível (/sellers é 404, " +
      "e o sellerId do contrato é o vendedor da época da venda).",
    entrada: z.object({ incluirInativos: z.boolean().default(false) }),
    somenteLeitura: true,
    executar: async (a) => ({ agentes: await listarAgentes(a) }),
  }),

  ferramenta({
    nome: "agente_criar",
    titulo: "Cadastrar agente",
    descricao:
      "Cadastra alguém do time comercial. Os ids de ClickUp e Chatwoot são o roster do disparo " +
      "futuro e podem ficar em branco — a camada de disparo ainda não existe.",
    entrada: z.object({
      nome: z.string().min(1),
      email: z.string().optional(),
      apelido: z.string().optional(),
      clickupUserId: z.string().optional(),
      chatwootAgentId: z.string().optional(),
      observacao: z.string().optional(),
      ativo: z.boolean().default(true),
    }),
    somenteLeitura: false,
    executar: async (a, ctx) => criarAgente(a, { quem: ctx.quem, origem: ctx.origem }),
  }),

  ferramenta({
    nome: "agente_atualizar",
    titulo: "Editar agente",
    descricao:
      "Muda os dados de um agente, inclusive desativar (`ativo: false`). " +
      "Desativar preserva o histórico de contatos dele; é o caminho certo para quem saiu.",
    entrada: z.object({
      id: z.string(),
      nome: z.string().optional(),
      email: z.string().optional(),
      apelido: z.string().optional(),
      clickupUserId: z.string().optional(),
      chatwootAgentId: z.string().optional(),
      observacao: z.string().optional(),
      ativo: z.boolean().optional(),
    }),
    somenteLeitura: false,
    idempotente: true,
    executar: async (a, ctx) => {
      const { id, ...dados } = a;
      return atualizarAgente(id, dados, { quem: ctx.quem, origem: ctx.origem });
    },
  }),

  ferramenta({
    nome: "agente_remover",
    titulo: "Remover agente",
    descricao:
      "Apaga o cadastro. Só funciona para quem NUNCA registrou contato — quem já registrou deve " +
      "ser desativado, para o histórico não perder de quem foi o contato. " +
      "Serve para o caso banal do cadastro digitado errado.",
    entrada: z.object({ id: z.string() }),
    somenteLeitura: false,
    destrutiva: true,
    executar: async (a, ctx) => {
      await removerAgente(a.id, { quem: ctx.quem, origem: ctx.origem });
      return { removido: a.id };
    },
  }),

  // ── Categorias ──────────────────────────────────────────────────────────
  ferramenta({
    nome: "categorias_listar",
    titulo: "Listar categorias de serviço",
    descricao:
      "Como cada categoria do Conexa está sendo lida hoje: MANUAL (alguém classificou), " +
      "NOME (heurística de substring) ou NENHUM. Categorias com `planos: 0` não classificam " +
      "contrato nenhum. Divergência entre `segmento` e `sugestaoPeloNome` merece olhada: " +
      "ou o Conexa renomeou, ou a classificação está errada.",
    entrada: z.object({
      apenasEmUso: z.boolean().default(false).describe("só categorias com ao menos um plano"),
      naoClassificadas: z.boolean().default(false),
    }),
    somenteLeitura: true,
    executar: async (a) => {
      let cats = await lerCategorias();
      if (a.apenasEmUso) cats = cats.filter((c) => c.planos > 0);
      if (a.naoClassificadas) cats = cats.filter((c) => c.origem !== "MANUAL");
      return {
        categorias: cats,
        segmentosValidos: SEGMENTOS,
        oQueCadaSegmentoDestrava: REGRAS_DO_SEGMENTO,
      };
    },
  }),

  ferramenta({
    nome: "categoria_classificar",
    titulo: "Classificar categoria",
    descricao:
      "Declara o que uma categoria de serviço é. A classificação manual VENCE a heurística de nome " +
      "e é por id — então renomear a categoria no Conexa deixa de quebrar as regras de segmento. " +
      "IGNORAR é resposta ('olhamos e não interessa'), diferente de não classificar. " +
      "`unidade` é a unidade física (ex.: 'Ayrton Senna', 'Seaway Center', 'Sebrae') e vira filtro na Carteira.",
    entrada: z.object({
      serviceCategoryConexaId: z.number().int(),
      segmento: z.enum(SEGMENTOS as [string, ...string[]]),
      rotulo: z.string().optional().describe("nome de exibição; não substitui o do Conexa"),
      unidade: z.string().optional(),
      nota: z.string().optional(),
    }),
    somenteLeitura: false,
    idempotente: true,
    executar: async (a, ctx) => {
      const { serviceCategoryConexaId, ...dados } = a;
      return classificarCategoria(
        serviceCategoryConexaId,
        dados as Parameters<typeof classificarCategoria>[1],
        { quem: ctx.quem, origem: ctx.origem },
      );
    },
  }),

  ferramenta({
    nome: "categoria_limpar_classificacao",
    titulo: "Limpar classificação",
    descricao:
      "Remove a classificação manual: a categoria volta a ser lida pela heurística de nome.",
    entrada: z.object({ serviceCategoryConexaId: z.number().int() }),
    somenteLeitura: false,
    destrutiva: true,
    executar: async (a, ctx) =>
      limparClassificacao(a.serviceCategoryConexaId, { quem: ctx.quem, origem: ctx.origem }),
  }),

  // ── Auditoria ───────────────────────────────────────────────────────────
  ferramenta({
    nome: "mudancas_de_config",
    titulo: "Histórico de mudanças",
    descricao:
      "Quem mudou o quê na configuração, e por qual via. `origem: 'MCP'` é mudança feita por " +
      "agente; 'UI' é mudança feita por pessoa na tela. Chame isto quando a fila mudar de tamanho " +
      "sem explicação — normalmente alguém mexeu num limiar.",
    entrada: z.object({
      entidade: z.enum(["gatilho", "agente", "categoria"]).optional(),
      limite: z.number().int().min(1).max(200).default(30),
    }),
    somenteLeitura: true,
    executar: async (a) => ({
      mudancas: await prisma.mudancaDeConfig.findMany({
        where: a.entidade ? { entidade: a.entidade } : undefined,
        orderBy: { em: "desc" },
        take: a.limite,
      }),
    }),
  }),
];
