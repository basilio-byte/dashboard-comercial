import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/env";
import { atender, INFO_SERVIDOR, VERSAO_PROTOCOLO, textoDeErro, ERRO } from "@/lib/mcp/protocolo";
import { FERRAMENTAS, RESUMO_DAS_FERRAMENTAS } from "@/lib/mcp/servidor";
import type { ContextoMcp } from "@/lib/mcp/tipos";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * PORTA MCP DO PAINEL — JSON-RPC sobre HTTP, sem estado.
 *
 * Registrar no Claude Code:
 *
 *   claude mcp add --transport http seahub-comercial \
 *     https://SEU-DOMINIO/api/mcp \
 *     --header "Authorization: Bearer $MCP_TOKEN"
 *
 * ⚠ **Sem `MCP_TOKEN` a rota responde 503, não 200.** Um deploy que esquece a
 * variável não pode virar um endpoint anônimo com escrita no banco e consumo do
 * rate limit compartilhado do Conexa. Mesma postura da rota de sync.
 *
 * ⚠ **Sem SSE.** O transporte "streamable HTTP" do MCP permite o servidor
 * responder por fluxo de eventos; aqui toda resposta é um JSON só. Nenhuma
 * ferramenta deste servidor emite progresso parcial, então o fluxo não
 * carregaria nada — e sessão SSE presa a uma réplica é exatamente o que o
 * ADR-0003 evita no agendador.
 */

function naoAutorizado(motivo: string) {
  return NextResponse.json(
    { jsonrpc: "2.0", id: null, error: { code: ERRO.requisicaoInvalida, message: motivo } },
    { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="seahub-comercial"' } },
  );
}

function autenticar(req: NextRequest): { ok: true; quem: string } | { ok: false; resposta: NextResponse } {
  const env = getEnv();
  if (!env.MCP_TOKEN) {
    return {
      ok: false,
      resposta: NextResponse.json(
        {
          jsonrpc: "2.0",
          id: null,
          error: {
            code: ERRO.interno,
            message:
              "MCP_TOKEN não configurado — rota desabilitada por segurança. " +
              "Defina a variável no serviço e reinicie.",
          },
        },
        { status: 503 },
      ),
    };
  }

  const cabecalho = req.headers.get("authorization") ?? "";
  const doHeader = cabecalho.toLowerCase().startsWith("bearer ")
    ? cabecalho.slice(7).trim()
    : req.headers.get("x-mcp-token")?.trim() ?? "";

  if (!doHeader) return { ok: false, resposta: naoAutorizado("Falta o header Authorization: Bearer.") };
  if (!iguaisEmTempoConstante(doHeader, env.MCP_TOKEN)) {
    return { ok: false, resposta: naoAutorizado("Token inválido.") };
  }

  // Quem está chamando, para o rastro de auditoria. É declarado pelo cliente e
  // NÃO é confiável como identidade — serve para distinguir agentes entre si,
  // não para autorizar. A autorização é o token, e o token não é uma pessoa.
  const cliente = req.headers.get("x-mcp-cliente")?.trim().slice(0, 60);
  return { ok: true, quem: `mcp:${cliente || "desconhecido"}` };
}

/**
 * Comparação em tempo constante.
 *
 * ⚠ `a === b` vaza o tamanho do prefixo comum pelo tempo de resposta. É um
 * ataque teórico contra um endpoint interno — e também é uma linha de código.
 */
function iguaisEmTempoConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diferenca = 0;
  for (let i = 0; i < a.length; i++) diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferenca === 0;
}

export async function POST(req: NextRequest) {
  const auth = autenticar(req);
  if (!auth.ok) return auth.resposta;

  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: ERRO.parse, message: "JSON inválido." } },
      { status: 400 },
    );
  }

  const somenteLeitura = getEnv().MCP_SOMENTE_LEITURA === "on";
  const ferramentas = somenteLeitura ? FERRAMENTAS.filter((f) => f.somenteLeitura) : FERRAMENTAS;

  const contexto: ContextoMcp = { quem: auth.quem, origem: "MCP" };
  const servidor = { ferramentas, contexto };

  // JSON-RPC permite lote. O MCP recente desencoraja, mas responder a um lote
  // custa três linhas e evita um erro obscuro num cliente que ainda o mande.
  if (Array.isArray(corpo)) {
    const respostas = (await Promise.all(corpo.map((m) => atender(m, servidor)))).filter(
      (r) => r !== null,
    );
    return respostas.length ? NextResponse.json(respostas) : new NextResponse(null, { status: 202 });
  }

  // ⚠ Quando o MCP está travado em leitura, a ferramenta de escrita não some
  // em silêncio: ela some de `tools/list` E a chamada direta recebe um motivo.
  // Ferramenta que "não existe" quando existe manda o agente tentar caminhos
  // cada vez mais criativos para fazer a mesma coisa.
  if (somenteLeitura && ehChamadaDeEscrita(corpo)) {
    const nome = (corpo as { params?: { name?: string } }).params?.name ?? "";
    return NextResponse.json({
      jsonrpc: "2.0",
      id: (corpo as { id?: string | number }).id ?? null,
      result: textoDeErro(
        `A ferramenta "${nome}" escreve, e este servidor está com MCP_SOMENTE_LEITURA=on. ` +
          "Peça a quem administra o serviço para desligar a trava, ou use a tela do painel.",
      ),
    });
  }

  const resposta = await atender(corpo, servidor);
  return resposta ? NextResponse.json(resposta) : new NextResponse(null, { status: 202 });
}

function ehChamadaDeEscrita(msg: unknown): boolean {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as { method?: string; params?: { name?: string } };
  if (m.method !== "tools/call" || !m.params?.name) return false;
  const f = FERRAMENTAS.find((x) => x.nome === m.params!.name);
  return !!f && !f.somenteLeitura;
}

/**
 * GET serve de cartão de visita, não de fluxo de eventos.
 *
 * Um cliente MCP que abre GET esperando SSE recebe 405 e cai para POST, que é o
 * comportamento previsto. Quem abre no navegador vê o que é este endereço — e
 * isso vale mais que um 405 vazio, porque o primeiro contato com uma rota nova
 * costuma ser alguém colando a URL no navegador.
 */
export async function GET(req: NextRequest) {
  const auth = autenticar(req);
  const env = getEnv();
  const somenteLeitura = env.MCP_SOMENTE_LEITURA === "on";
  // ⚠ A lista precisa ser a MESMA que `tools/list` devolve. Um cartão de visita
  // que anuncia 31 ferramentas enquanto o protocolo entrega 18 manda quem está
  // integrando procurar defeito no cliente dele.
  const expostas = somenteLeitura
    ? RESUMO_DAS_FERRAMENTAS.filter((f) => !f.escreve)
    : RESUMO_DAS_FERRAMENTAS;
  return NextResponse.json(
    {
      servidor: INFO_SERVIDOR,
      protocolo: VERSAO_PROTOCOLO,
      transporte: "http (JSON-RPC, sem SSE)",
      autenticado: auth.ok,
      somenteLeitura,
      ferramentas: auth.ok ? expostas : undefined,
      comoUsar:
        'claude mcp add --transport http seahub-comercial <esta-url> --header "Authorization: Bearer $MCP_TOKEN"',
    },
    { status: auth.ok ? 200 : 401 },
  );
}
