#!/usr/bin/env node
/**
 * PONTE STDIO → HTTP do MCP do Dashboard Comercial.
 *
 * O servidor de verdade é a rota `/api/mcp` do painel. Esta ponte existe só
 * para os clientes que falam **apenas stdio** (Claude Desktop e alguns IDEs).
 * Quem fala HTTP — Claude Code, por exemplo — deve apontar direto para a rota,
 * sem passar por aqui: um processo a menos no caminho é um lugar a menos para
 * quebrar.
 *
 * ⚠ A ponte NÃO tem lógica de MCP. Ela move bytes. Toda decisão — quais
 * ferramentas existem, o que cada uma valida, quem escreveu o quê — vive no
 * servidor. Se um dia esta ponte precisar entender uma mensagem para
 * funcionar, é sinal de que alguém pôs regra no lugar errado.
 *
 * Uso:
 *   MCP_URL=https://painel/api/mcp MCP_TOKEN=... node scripts/mcp-stdio.mjs
 *   node scripts/mcp-stdio.mjs --url https://painel/api/mcp --token ...
 */

import process from "node:process";
import { createInterface } from "node:readline";

const argv = process.argv.slice(2);
const arg = (nome) => {
  const i = argv.indexOf(`--${nome}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const URL_MCP = arg("url") ?? process.env.MCP_URL ?? "http://localhost:7000/api/mcp";
const TOKEN = arg("token") ?? process.env.MCP_TOKEN ?? "";
const CLIENTE = arg("cliente") ?? process.env.MCP_CLIENTE ?? "stdio";

if (!TOKEN) {
  // ⚠ stderr, nunca stdout: stdout é o canal do protocolo, e uma linha de
  // aviso ali dentro corrompe a primeira mensagem — o cliente mostra "erro de
  // JSON" e ninguém relaciona com a mensagem de ajuda.
  process.stderr.write(
    "[mcp-stdio] MCP_TOKEN não definido. O servidor vai recusar com 401.\n",
  );
}

/** Uma linha de stdout por mensagem. O protocolo é JSON delimitado por \n. */
function responder(objeto) {
  process.stdout.write(`${JSON.stringify(objeto)}\n`);
}

function erro(id, code, message) {
  responder({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}

const leitor = createInterface({ input: process.stdin, crlfDelay: Infinity });

leitor.on("line", async (linha) => {
  const texto = linha.trim();
  if (!texto) return;

  let msg;
  try {
    msg = JSON.parse(texto);
  } catch {
    erro(null, -32700, "JSON inválido recebido pela ponte stdio.");
    return;
  }

  try {
    const resposta = await fetch(URL_MCP, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${TOKEN}`,
        "x-mcp-cliente": CLIENTE,
      },
      body: JSON.stringify(msg),
    });

    // 202 = era notificação; o servidor não respondeu e nós também não
    // devemos. Responder a uma notificação quebra clientes estritos.
    if (resposta.status === 202) return;

    const texto = await resposta.text();
    if (!texto) return;

    try {
      responder(JSON.parse(texto));
    } catch {
      // O servidor devolveu algo que não é JSON — tipicamente uma página de
      // erro de proxy. Repassar o corpo cru ajuda a diagnosticar; engolir não.
      erro(
        msg.id,
        -32603,
        `Resposta não-JSON do servidor (HTTP ${resposta.status}): ${texto.slice(0, 500)}`,
      );
    }
  } catch (err) {
    erro(msg.id, -32603, `Falha ao falar com ${URL_MCP}: ${err?.message ?? String(err)}`);
  }
});

leitor.on("close", () => process.exit(0));
