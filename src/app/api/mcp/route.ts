import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/env";
import { atender, INFO_SERVIDOR, VERSAO_PROTOCOLO, textoDeErro, ERRO } from "@/lib/mcp/protocolo";
import { FERRAMENTAS, RESUMO_DAS_FERRAMENTAS } from "@/lib/mcp/servidor";
import type { ContextoMcp } from "@/lib/mcp/tipos";
import { autenticarTokenMcp, existeTokenPessoalAtivo } from "@/lib/mcp/tokens";
import { PREFIXO_TOKEN } from "@/lib/mcp/token-formato";

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
 * ⚠ **Dois tipos de token, desde 2026-09-18:**
 *  - **pessoal** (`shc_…`), criado em Minha conta. O rastro de auditoria diz
 *    QUEM fez, o escopo pode ser só leitura, e revogar um não derruba os outros;
 *  - **master**, o `MCP_TOKEN` do ambiente — mantido a pedido do dono para o
 *    desenvolvimento. Acesso total, e aparece no rastro como `mcp:master`.
 *
 * ⚠ **Sem nenhum dos dois configurado, a rota responde 503, não 200.** Um deploy
 * que esquece a variável não pode virar um endpoint anônimo com escrita no banco
 * e consumo do rate limit compartilhado do Conexa.
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

interface Autenticado {
  ok: true;
  /** Vai para `mudancas_de_config.quem`. */
  quem: string;
  somenteLeitura: boolean;
  /** Por que é só leitura, quando for — a mensagem de recusa depende disso. */
  motivoDaLeitura: "ambiente" | "token" | null;
  tipo: "master" | "pessoal";
}

async function autenticar(
  req: NextRequest,
): Promise<Autenticado | { ok: false; resposta: NextResponse }> {
  const env = getEnv();
  const travaDoAmbiente = env.MCP_SOMENTE_LEITURA === "on";

  const cabecalho = req.headers.get("authorization") ?? "";
  const valor = cabecalho.toLowerCase().startsWith("bearer ")
    ? cabecalho.slice(7).trim()
    : req.headers.get("x-mcp-token")?.trim() ?? "";

  // Rótulo que o CLIENTE declara ("claude-code", "claude-desktop"). Não prova
  // nada — só distingue, no rastro, de onde veio a chamada da mesma pessoa.
  const cliente = req.headers.get("x-mcp-cliente")?.trim().slice(0, 40);

  // ── token pessoal ──────────────────────────────────────────────────────
  if (valor.startsWith(PREFIXO_TOKEN)) {
    const id = await autenticarTokenMcp(valor);
    if (!id) return { ok: false, resposta: naoAutorizado("Token inválido, revogado ou de usuário inativo.") };
    const somenteLeitura = travaDoAmbiente || id.escopo === "LEITURA";
    return {
      ok: true,
      quem: `${id.email} via MCP (${id.nomeDoToken}${cliente ? `, ${cliente}` : ""})`,
      somenteLeitura,
      motivoDaLeitura: travaDoAmbiente ? "ambiente" : id.escopo === "LEITURA" ? "token" : null,
      tipo: "pessoal",
    };
  }

  // ── token master ───────────────────────────────────────────────────────
  if (!env.MCP_TOKEN) {
    // Sem master: só token pessoal serve. Se nem pessoal existe, a rota está
    // fechada de fato — e a mensagem precisa dizer o caminho, não só "não".
    if (!(await existeTokenPessoalAtivo())) {
      return {
        ok: false,
        resposta: NextResponse.json(
          {
            jsonrpc: "2.0",
            id: null,
            error: {
              code: ERRO.interno,
              message:
                "Nenhum token configurado — rota fechada. Crie um token pessoal em Minha conta, " +
                "ou defina MCP_TOKEN (master) no serviço.",
            },
          },
          { status: 503 },
        ),
      };
    }
    return { ok: false, resposta: naoAutorizado("Use um token pessoal (Minha conta → Tokens do MCP).") };
  }

  if (!valor) return { ok: false, resposta: naoAutorizado("Falta o header Authorization: Bearer.") };
  if (!iguaisEmTempoConstante(valor, env.MCP_TOKEN)) {
    return { ok: false, resposta: naoAutorizado("Token inválido.") };
  }
  return {
    ok: true,
    quem: `mcp:master${cliente ? ` (${cliente})` : ""}`,
    somenteLeitura: travaDoAmbiente,
    motivoDaLeitura: travaDoAmbiente ? "ambiente" : null,
    tipo: "master",
  };
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
  const auth = await autenticar(req);
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

  const somenteLeitura = auth.somenteLeitura;
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
        auth.motivoDaLeitura === "token"
          ? `A ferramenta "${nome}" escreve, e o seu token é SOMENTE LEITURA. ` +
              "Crie um token com escopo de escrita em Minha conta, ou use a tela do painel."
          : `A ferramenta "${nome}" escreve, e este servidor está com MCP_SOMENTE_LEITURA=on. ` +
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
  const auth = await autenticar(req);
  const somenteLeitura = auth.ok ? auth.somenteLeitura : false;
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
      // Quem o servidor acha que você é — o jeito mais rápido de conferir se o
      // token certo está configurado no cliente.
      identidade: auth.ok ? auth.quem : undefined,
      tipoDeToken: auth.ok ? auth.tipo : undefined,
      somenteLeitura,
      ferramentas: auth.ok ? expostas : undefined,
      comoUsar:
        'claude mcp add --transport http seahub-comercial <esta-url> --header "Authorization: Bearer $MCP_TOKEN"',
    },
    { status: auth.ok ? 200 : 401 },
  );
}
