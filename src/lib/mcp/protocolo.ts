import { paraJsonSchema } from "./esquema";
import type { Ferramenta, ContextoMcp } from "./tipos";

/**
 * O PROTOCOLO MCP, no mínimo necessário — JSON-RPC 2.0 sobre HTTP.
 *
 * ⚠ Escrito à mão, e a decisão tem motivo. O SDK oficial traz um transporte
 * que quer o `http.ServerResponse` do Node, e o App Router do Next 15 entrega
 * `Request`/`Response` da Web. Encaixar os dois exige um adaptador, que é uma
 * dependência a mais no caminho do build do Docker — e o build do Docker é o
 * que publica este projeto. Um servidor **sem estado** de MCP é um `switch`
 * sobre seis métodos; o adaptador custaria mais que o switch.
 *
 * ⚠ **Sem estado, de propósito.** Cada requisição carrega tudo o que precisa e
 * o servidor não guarda sessão. Isso é o que permite o painel rodar com mais de
 * uma réplica no Easypanel sem uma sessão de MCP presa à réplica que a criou —
 * o mesmo raciocínio do ADR-0003 sobre o agendador.
 *
 * Esta camada é PURA: recebe a mensagem já decodificada, devolve a resposta.
 * Não sabe de HTTP, de cabeçalho nem de token. É o que a torna testável.
 */

export const VERSAO_PROTOCOLO = "2025-06-18";
/** Versões que sabemos atender. A negociação devolve a do cliente quando cabe. */
const VERSOES_ACEITAS = new Set(["2025-06-18", "2025-03-26", "2024-11-05"]);

export const INFO_SERVIDOR = {
  name: "seahub-comercial",
  title: "Dashboard Comercial Seahub",
  version: "1.0.0",
} as const;

/**
 * As instruções que o cliente de IA lê antes da primeira chamada.
 *
 * ⚠ Não é enfeite. Um agente que não sabe que `saldo de horas` é uma lacuna
 * conhecida vai tentar calculá-lo de três jeitos errados e apresentar um
 * número. As regras de ouro do projeto precisam chegar a quem vai usar as
 * ferramentas, e este é o único lugar que o cliente lê sem ser perguntado.
 */
export const INSTRUCOES = `Dashboard Comercial da Seahub Coworking — espelho local do ERP Conexa mais o motor de regras que aponta quem o vendedor deve procurar.

REGRAS DE OURO, que valem para toda resposta que você montar com estas ferramentas:

1. LACUNA SE DECLARA COMO LACUNA. Todo número exibido tem procedência (API / DERIVADO / MANUAL / INDISPONIVEL). Nunca apresente um valor INDISPONIVEL como zero, nem estime o que a API não expõe.
2. SALDO DE HORAS DO PACOTE NÃO É CALCULÁVEL. O endpoint /packages do Conexa responde 404 por permissão deste token. As regras 2 e 9 estão bloqueadas por isso — é liberação de admin, não trabalho de código. Não tente derivar o saldo.
3. VENDEDOR RESPONSÁVEL NÃO É RESOLVÍVEL. /sellers também é 404, e o sellerId gravado no contrato é o vendedor da época da venda.
4. O SISTEMA NUNCA FALA COM O CLIENTE. Toda saída é interna, para o vendedor ler e decidir. Não redija mensagem para cliente final.
5. NADA DISPARA. A camada de disparo (ClickUp/Chatwoot) não existe; avaliar um gatilho não cria task em lugar nenhum.
6. RECEITA usa regime de EMISSÃO e o campo currentAmount (com juros/multa), para bater ao centavo com o dashboard financeiro. Cobrança cancelada e renegociada saem dos totais.
7. COMPLETUDE ANTES DE FATO. Consulte estado_do_espelho antes de afirmar números: nada derivado vale como fato enquanto a fonte estiver incompleta.

ESCRITA: as ferramentas que alteram configuração gravam quem mudou o quê em mudancas_de_config, com origem MCP. Prefira ler antes de escrever, e diga ao usuário o que vai mudar antes de mudar.`;

// ---------------------------------------------------------------------------
// JSON-RPC
// ---------------------------------------------------------------------------

export interface Requisicao {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface Resposta {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export const ERRO = {
  parse: -32700,
  requisicaoInvalida: -32600,
  metodoDesconhecido: -32601,
  parametrosInvalidos: -32602,
  interno: -32603,
} as const;

const ok = (id: Requisicao["id"], result: unknown): Resposta => ({
  jsonrpc: "2.0",
  id: id ?? null,
  result,
});

const falha = (id: Requisicao["id"], code: number, message: string, data?: unknown): Resposta => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: { code, message, ...(data === undefined ? {} : { data }) },
});

// ---------------------------------------------------------------------------
// Atendimento
// ---------------------------------------------------------------------------

export interface Servidor {
  ferramentas: Ferramenta[];
  contexto: ContextoMcp;
}

/**
 * Atende uma mensagem. `null` = notificação, que por definição não responde.
 */
export async function atender(msg: unknown, servidor: Servidor): Promise<Resposta | null> {
  if (typeof msg !== "object" || msg === null) {
    return falha(null, ERRO.requisicaoInvalida, "Mensagem não é um objeto JSON-RPC.");
  }
  const req = msg as Requisicao;
  if (req.jsonrpc !== "2.0" || typeof req.method !== "string") {
    return falha(req.id ?? null, ERRO.requisicaoInvalida, "Faltam `jsonrpc: \"2.0\"` ou `method`.");
  }

  // Notificação: sem `id`. Responder a uma notificação quebra clientes que não
  // esperam resposta.
  const ehNotificacao = req.id === undefined || req.id === null;

  switch (req.method) {
    case "initialize": {
      const pedida = (req.params?.protocolVersion as string | undefined) ?? VERSAO_PROTOCOLO;
      return ok(req.id, {
        protocolVersion: VERSOES_ACEITAS.has(pedida) ? pedida : VERSAO_PROTOCOLO,
        capabilities: {
          // `listChanged: false` é honesto: a lista de ferramentas é estática
          // dentro de um processo. Anunciar `true` sem nunca emitir a
          // notificação faria o cliente esperar por um aviso que não vem.
          tools: { listChanged: false },
        },
        serverInfo: INFO_SERVIDOR,
        instructions: INSTRUCOES,
      });
    }

    case "notifications/initialized":
    case "notifications/cancelled":
      return null;

    case "ping":
      return ehNotificacao ? null : ok(req.id, {});

    case "tools/list":
      return ok(req.id, {
        tools: servidor.ferramentas.map(descrever),
      });

    case "tools/call":
      return chamar(req, servidor);

    // Anunciamos só `tools`, mas clientes sondam estes dois assim mesmo.
    // Responder lista vazia é mais educado que -32601 num log de erro.
    case "resources/list":
      return ok(req.id, { resources: [] });
    case "resources/templates/list":
      return ok(req.id, { resourceTemplates: [] });
    case "prompts/list":
      return ok(req.id, { prompts: [] });

    default:
      if (ehNotificacao) return null;
      return falha(req.id, ERRO.metodoDesconhecido, `Método desconhecido: ${req.method}`);
  }
}

function descrever(f: Ferramenta) {
  return {
    name: f.nome,
    title: f.titulo,
    description: f.descricao,
    inputSchema: paraJsonSchema(f.entrada),
    annotations: {
      title: f.titulo,
      readOnlyHint: f.somenteLeitura,
      destructiveHint: f.destrutiva ?? false,
      // Idempotente = repetir a chamada não muda mais nada. Vale para leitura
      // e para os upserts de configuração.
      idempotentHint: f.somenteLeitura || (f.idempotente ?? false),
      openWorldHint: f.mundoAberto ?? false,
    },
  };
}

async function chamar(req: Requisicao, servidor: Servidor): Promise<Resposta> {
  const nome = req.params?.name;
  if (typeof nome !== "string") {
    return falha(req.id, ERRO.parametrosInvalidos, "`params.name` é obrigatório.");
  }
  const f = servidor.ferramentas.find((x) => x.nome === nome);
  if (!f) {
    return falha(
      req.id,
      ERRO.parametrosInvalidos,
      `Ferramenta desconhecida: ${nome}. Use tools/list para ver as disponíveis.`,
    );
  }

  const bruto = (req.params?.arguments as Record<string, unknown> | undefined) ?? {};
  const validado = f.entrada.safeParse(bruto);
  if (!validado.success) {
    // ⚠ Erro de validação volta como RESULTADO com `isError`, e não como erro
    // JSON-RPC. A diferença importa: erro de protocolo o cliente esconde do
    // modelo, e o modelo repete a mesma chamada errada para sempre. Como
    // resultado, ele lê o que faltou e corrige na tentativa seguinte.
    return ok(req.id, textoDeErro(
      `Argumentos inválidos para ${nome}:\n` +
        validado.error.issues
          .map((i) => `  · ${i.path.join(".") || "(raiz)"}: ${i.message}`)
          .join("\n"),
    ));
  }

  try {
    const saida = await f.executar(validado.data, servidor.contexto);
    return ok(req.id, resultado(saida));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return ok(req.id, textoDeErro(msg));
  }
}

/**
 * Empacota o retorno de uma ferramenta.
 *
 * ⚠ `content` em texto E `structuredContent` juntos, sempre. Clientes antigos
 * só leem `content`; os novos preferem o estruturado. Mandar só um dos dois
 * funciona no cliente que você testou e falha no do colega.
 */
export function resultado(saida: unknown): Record<string, unknown> {
  const texto =
    typeof saida === "string" ? saida : JSON.stringify(saida, substituir, 2);
  const r: Record<string, unknown> = {
    content: [{ type: "text", text: texto }],
    isError: false,
  };
  if (saida !== null && typeof saida === "object" && !Array.isArray(saida)) {
    r.structuredContent = JSON.parse(JSON.stringify(saida, substituir));
  }
  return r;
}

export function textoDeErro(mensagem: string): Record<string, unknown> {
  return { content: [{ type: "text", text: mensagem }], isError: true };
}

/**
 * ⚠ `Decimal` do Prisma e `BigInt` não sobrevivem a `JSON.stringify` do jeito
 * que se espera: o primeiro vira `{"s":1,"e":2,...}` e o segundo lança
 * `TypeError`. Dinheiro virar objeto de três letras num MCP é como um número
 * errado chega a um relatório.
 */
function substituir(_chave: string, valor: unknown): unknown {
  if (typeof valor === "bigint") return Number(valor);
  if (valor instanceof Date) return valor.toISOString();
  if (
    valor !== null &&
    typeof valor === "object" &&
    "toFixed" in valor &&
    typeof (valor as { toFixed: unknown }).toFixed === "function" &&
    "toString" in valor
  ) {
    // Decimal.js: string preserva a precisão que o float perderia.
    return (valor as { toString(): string }).toString();
  }
  return valor;
}
