#!/usr/bin/env node
/**
 * FASE 0 — Provas de acesso à API Conexa v2.
 *
 * Cinco medições que decidem o ESCOPO REAL do Dashboard Comercial. Rodar isto
 * ANTES de escrever qualquer linha de aplicação — ver docs/context/roadmap.md.
 *
 * ============================ SOMENTE LEITURA ============================
 * Este script NUNCA escreve no Conexa. O token é de admin e tem privilégios
 * altos; um POST/PATCH/DELETE acidental alteraria dados reais da empresa.
 *
 * A garantia é ESTRUTURAL, não uma promessa: `pedir()` tem o método fixo em
 * GET e não existe parâmetro de `method` nem de `body`. Não há caminho de
 * código capaz de escrever. Ver docs/context/conexa-integration.md.
 * ========================================================================
 *
 * Uso:
 *   CONEXA_API_TOKEN=xxx node scripts/fase-0-provas.mjs
 *
 * Variáveis:
 *   CONEXA_API_TOKEN            (obrigatória) token permanente de admin
 *   CONEXA_BASE_URL             default: https://seahubcoworking.conexa.app/index.php/api/v2
 *   CONEXA_RATE_LIMIT_PER_MIN   default: 15  — CONSERVADOR de propósito: o teto de
 *                               60 req/min é COMPARTILHADO com o Dashboard Financeiro,
 *                               que já roda em produção. Ver ADR-0002.
 *   FASE0_MAX_REQ               default: 80  — disjuntor: o script para sozinho.
 *
 * Saída: docs/context/fase-0-resultado.md (ignorado pelo git — pode conter dado
 * de cliente real) + resumo no terminal.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const BASE_URL = (
  process.env.CONEXA_BASE_URL ??
  "https://seahubcoworking.conexa.app/index.php/api/v2"
).replace(/\/$/, "");
const TOKEN = process.env.CONEXA_API_TOKEN ?? "";
const REQ_POR_MIN = Number(process.env.CONEXA_RATE_LIMIT_PER_MIN ?? 15);
const MAX_REQ = Number(process.env.FASE0_MAX_REQ ?? 80);

if (!TOKEN) {
  console.error(
    "\n  ERRO: CONEXA_API_TOKEN não definido.\n\n" +
      "  O token vive no 1Password — nunca em arquivo do repositório.\n" +
      "  Exemplo:  CONEXA_API_TOKEN=xxx node scripts/fase-0-provas.mjs\n",
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Cliente HTTP — GET fixo, com espaçamento e retry.
// ---------------------------------------------------------------------------

const INTERVALO_MS = Math.ceil((60_000 / REQ_POR_MIN) * 1.05); // +5% de margem
let ultimaChamada = 0;
let requisicoesFeitas = 0;
/** Últimos headers de rate limit vistos — insumo da Prova 2. */
let ultimoRateLimit = {};

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function montarUrl(caminho, query = {}) {
  const url = new URL(`${BASE_URL}/${caminho.replace(/^\//, "")}`);
  for (const [chave, valor] of Object.entries(query)) {
    if (valor === undefined || valor === null) continue;
    // A Conexa exige o parâmetro REPETIDO para arrays: id[]=1&id[]=2.
    // Juntar com vírgula devolve silenciosamente o conjunto errado.
    if (Array.isArray(valor)) {
      for (const v of valor) url.searchParams.append(chave, String(v));
    } else {
      url.searchParams.set(chave, String(valor));
    }
  }
  return url.toString();
}

/**
 * Requisição GET autenticada. Devolve { ok, status, corpo, headers } — NUNCA
 * lança por status HTTP, porque aqui um 403 é RESULTADO DE MEDIÇÃO, não erro.
 */
async function pedir(caminho, query = {}) {
  if (requisicoesFeitas >= MAX_REQ) {
    throw new Error(
      `Disjuntor: ${MAX_REQ} requisições atingidas (FASE0_MAX_REQ). Abortando para não competir com o dashboard financeiro pelo rate limit.`,
    );
  }

  const espera = ultimaChamada + INTERVALO_MS - Date.now();
  if (espera > 0) await dormir(espera);
  ultimaChamada = Date.now();
  requisicoesFeitas++;

  const url = montarUrl(caminho, query);

  for (let tentativa = 1; ; tentativa++) {
    let res;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 30_000);
      try {
        res = await fetch(url, {
          method: "GET", // fixo — ver o bloco SOMENTE LEITURA no topo
          headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" },
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(t);
      }
    } catch (err) {
      if (tentativa > 4) return { ok: false, status: 0, erroRede: String(err?.message ?? err) };
      await dormir(Math.min(15_000, 2 ** tentativa * 500));
      continue;
    }

    const rl = {
      limite: res.headers.get("X-Rate-Limit-Limit"),
      restante: res.headers.get("X-Rate-Limit-Remaining"),
      reset: res.headers.get("X-Rate-Limit-Reset"),
    };
    if (rl.limite || rl.restante) ultimoRateLimit = { ...rl, em: new Date().toISOString() };

    if (res.status === 429 && tentativa <= 4) {
      const reset = Number(rl.reset ?? res.headers.get("Retry-After") ?? 60);
      console.warn(`    429 recebido — aguardando ${reset}s`);
      await dormir((Number.isFinite(reset) ? reset : 60) * 1000 + 250);
      continue;
    }
    if (res.status >= 500 && tentativa <= 4) {
      await dormir(Math.min(15_000, 2 ** tentativa * 500));
      continue;
    }

    let corpo;
    try {
      corpo = await res.json();
    } catch {
      corpo = undefined;
    }
    return { ok: res.ok, status: res.status, corpo, rateLimit: rl };
  }
}

const itens = (r) => (Array.isArray(r?.corpo) ? r.corpo : (r?.corpo?.data ?? []));

// ---------------------------------------------------------------------------
// Provas
// ---------------------------------------------------------------------------

const resultados = [];
function registrar(n, titulo, veredito, detalhe, consequencia) {
  resultados.push({ n, titulo, veredito, detalhe, consequencia });
  const cor = { PASSOU: "\x1b[32m", FALHOU: "\x1b[31m", PARCIAL: "\x1b[33m" }[veredito] ?? "";
  console.log(`  ${cor}${veredito.padEnd(7)}\x1b[0m Prova ${n} — ${titulo}`);
  if (detalhe) console.log(`          ${detalhe.split("\n").join("\n          ")}`);
}

/** PROVA 1 — o token enxerga /room/bookings? Decide 6 das 10 regras. */
async function prova1() {
  const r = await pedir("room/bookings", { limit: 1, offset: 0 });

  if (r.status === 403 || r.status === 401) {
    return registrar(
      1,
      "GET /room/bookings responde?",
      "FALHOU",
      `HTTP ${r.status}. A coleção documenta: "only available for authorized customers".`,
      "**6 das 10 regras caem** (2, 3, 4, 5, 9, 10). Abrir chamado na Conexa HOJE pedindo " +
        "liberação do endpoint. Reordenar o roadmap para as regras de contrato (1, 6, 7, 8), " +
        "que não dependem de reservas.",
    );
  }
  if (!r.ok) {
    return registrar(1, "GET /room/bookings responde?", "FALHOU", `HTTP ${r.status}.`, "Investigar antes de seguir.");
  }

  const lista = itens(r);
  const b = lista[0];
  const campos = b ? Object.keys(b) : [];
  const temCampos = ["bookingId", "startTime", "finalTime", "status", "customerId", "place"].filter(
    (c) => campos.includes(c),
  );

  return registrar(
    1,
    "GET /room/bookings responde?",
    "PASSOU",
    `HTTP 200, ${lista.length} registro(s) na amostra.\n` +
      `Campos esperados presentes: ${temCampos.join(", ") || "NENHUM (!)"}\n` +
      (b ? `Exemplo de status: ${JSON.stringify(b.status)}` : ""),
    "As 10 regras seguem viáveis do ponto de vista de acesso.",
  );
}

/** PROVA 2 — o teto de 60 req/min é por token ou por conta? */
async function prova2() {
  const antes = { ...ultimoRateLimit };
  await pedir("companies", { limit: 1 });
  const depois = { ...ultimoRateLimit };

  if (!depois.limite && !depois.restante) {
    return registrar(
      2,
      "Rate limit — por token ou por conta?",
      "PARCIAL",
      "A API não devolveu headers X-Rate-Limit-*. Não dá para medir por aqui.",
      "**Perguntar à Conexa** (pergunta 1 de perguntas-abertas.md). É a resposta que decide se o " +
        "ADR-0002 continua necessário ou se um segundo token resolve tudo.",
    );
  }

  const consumidoObservado =
    antes.restante != null && depois.restante != null
      ? Number(antes.restante) - Number(depois.restante)
      : null;

  const suspeitaCompartilhado = consumidoObservado != null && consumidoObservado > 1;

  return registrar(
    2,
    "Rate limit — por token ou por conta?",
    "PARCIAL",
    `Limite: ${depois.limite} · Restante: ${depois.restante} · Reset: ${depois.reset}\n` +
      (consumidoObservado != null
        ? `Consumo observado entre duas chamadas nossas: ${consumidoObservado}` +
          (suspeitaCompartilhado
            ? "  ← MAIOR que 1: indício de que OUTRO processo consome o mesmo balde"
            : "  (igual a 1: nenhum indício de consumo externo NESTE instante)")
        : ""),
    "Este é um **indício, não prova** — o financeiro pode estar ocioso agora. " +
      "A resposta definitiva vem da Conexa (pergunta 1). Para medir melhor: rodar este script " +
      "enquanto o dashboard financeiro faz um backfill e comparar o consumo observado.",
  );
}

/** PROVA 3 — GET /contracts devolve extraFields? Decide o desbloqueio da regra 10. */
async function prova3() {
  const lista = await pedir("contracts", { limit: 20, offset: 0 });
  if (!lista.ok) {
    return registrar(3, "GET /contracts devolve extraFields?", "FALHOU", `HTTP ${lista.status}.`, "Investigar.");
  }

  const contratos = itens(lista);
  const naLista = contratos.filter((c) => "extraFields" in c);

  // O detalhe pode expor o que a lista omite — vale a requisição extra.
  let naDetalhe = null;
  const primeiro = contratos[0];
  if (primeiro?.contractId) {
    const det = await pedir(`contract/${primeiro.contractId}`);
    if (det.ok && det.corpo) naDetalhe = "extraFields" in det.corpo;
  }

  const temAlgum = naLista.length > 0 || naDetalhe === true;

  return registrar(
    3,
    "GET /contracts devolve extraFields?",
    temAlgum ? "PASSOU" : "FALHOU",
    `Na LISTA: ${naLista.length}/${contratos.length} contratos trazem o campo.\n` +
      `No DETALHE (contract/${primeiro?.contractId ?? "?"}): ${naDetalhe === null ? "não testado" : naDetalhe}`,
    temAlgum
      ? "A regra 10 TEM caminho de desbloqueio: pedir à Seahub que preencha um extraField de " +
        "contrato com o tier (Simples/Litoral/Batial/...). É melhor que um mapa manual, porque não envelhece."
      : "A regra 10 **não tem** esse caminho. A única via é um mapa `planId → tier` homologado " +
        "por escrito. Reescrever a pergunta 45 como pergunta à Conexa, não como proposta ao cliente.",
  );
}

/** PROVA 4 — sale.quantity de uma venda de reserva carrega horas fracionárias? */
async function prova4() {
  const res = await pedir("room/bookings", { limit: 100, offset: 0 });
  if (!res.ok) {
    return registrar(
      4,
      "sale.quantity carrega horas fracionárias?",
      "FALHOU",
      `Não foi possível ler reservas (HTTP ${res.status}).`,
      "Depende da Prova 1.",
    );
  }

  const comVenda = itens(res)
    .filter((b) => b.saleId && b.startTime && b.finalTime)
    .slice(0, 20);

  if (!comVenda.length) {
    return registrar(
      4,
      "sale.quantity carrega horas fracionárias?",
      "PARCIAL",
      "Nenhuma reserva da amostra tem saleId + as duas pontas de horário.",
      "Ampliar a amostra manualmente antes de confiar no plano B da regra 4.",
    );
  }

  const vendas = await pedir("sales", { "id[]": comVenda.map((b) => b.saleId), limit: 100, offset: 0 });
  const porId = new Map(itens(vendas).map((s) => [s.saleId, s]));

  const comparacoes = [];
  for (const b of comVenda) {
    const s = porId.get(b.saleId);
    if (!s) continue;
    const horas = (new Date(b.finalTime) - new Date(b.startTime)) / 3_600_000;
    comparacoes.push({
      bookingId: b.bookingId,
      saleId: b.saleId,
      horas: Number(horas.toFixed(4)),
      quantity: s.quantity,
      bate: Math.abs(horas - Number(s.quantity)) < 0.01,
    });
  }

  const batem = comparacoes.filter((c) => c.bate).length;
  const fracionarios = comparacoes.filter((c) => !Number.isInteger(Number(c.quantity))).length;
  const taxa = comparacoes.length ? (batem / comparacoes.length) * 100 : 0;

  return registrar(
    4,
    "sale.quantity carrega horas fracionárias?",
    taxa === 100 ? "PASSOU" : taxa > 0 ? "PARCIAL" : "FALHOU",
    `${batem}/${comparacoes.length} pares (booking, sale) concordam — ${taxa.toFixed(1)}%.\n` +
      `Valores fracionários encontrados: ${fracionarios}\n` +
      `Amostra: ${JSON.stringify(comparacoes.slice(0, 5))}`,
    taxa === 100
      ? "O plano B da regra 4 (derivar consumo de /sales) é viável."
      : "A coleção tipa o campo como `integer` e como 'quantidade de ITENS'. " +
        "Com taxa abaixo de 100%, **não usar como fonte de horas** — manter NÃO CONFIRMADO.",
  );
}

/** PROVA 5 — hourPlanQuota vem preenchido nos contratos REAIS da Seahub? */
async function prova5() {
  const res = await pedir("contracts", { limit: 100, offset: 0, isActive: 1 });
  if (!res.ok) {
    return registrar(5, "hourPlanQuota vem preenchido?", "FALHOU", `HTTP ${res.status}.`, "Investigar.");
  }

  const contratos = itens(res);
  const comCota = contratos.filter((c) => Array.isArray(c.hourPlanQuota) && c.hourPlanQuota.length);
  const baldes = comCota.flatMap((c) => c.hourPlanQuota);
  const porSala = baldes.filter((q) => q.spaceId != null).length;
  const porGrupo = baldes.filter((q) => q.groupId != null).length;

  return registrar(
    5,
    "hourPlanQuota vem preenchido?",
    comCota.length ? (porGrupo ? "PARCIAL" : "PASSOU") : "FALHOU",
    `${comCota.length}/${contratos.length} contratos ativos têm cota de horas.\n` +
      `Baldes: ${baldes.length} — por SALA: ${porSala} · por GRUPO: ${porGrupo}`,
    porGrupo
      ? `**${porGrupo} balde(s) por GRUPO de salas são irrecuperáveis** — não existe endpoint que ` +
        "liste os membros de um grupo (ADR-0005). Pedir ao cliente a lista de quais salas compõem " +
        "cada grupo (pergunta 23), senão essas cotas ficam permanentemente indisponíveis."
      : comCota.length
        ? "Todas as cotas são por sala específica — o consumo é atribuível. Bom para as regras 2 e 9."
        : "Sem cota nos contratos ativos, a concessão precisa vir de /plans ou /recurringSales. Investigar.",
  );
}

/** EXTRA — o produto "Panteão" existe? Decide se a regra 8 sai do OFF. */
async function extraPanteao() {
  const alvos = ["pante"];
  const achados = [];
  for (let offset = 0; offset < 300; offset += 100) {
    const r = await pedir("products", { limit: 100, offset });
    if (!r.ok) break;
    const lista = itens(r);
    for (const p of lista) {
      const nome = String(p.name ?? "").toLowerCase();
      if (alvos.some((a) => nome.includes(a))) achados.push({ id: p.productId ?? p.id, nome: p.name });
    }
    if (lista.length < 100) break;
  }

  return registrar(
    "extra",
    'O produto "Panteão" existe no catálogo?',
    achados.length ? "PASSOU" : "FALHOU",
    achados.length ? JSON.stringify(achados) : "Nenhum produto com 'pante' no nome.",
    achados.length
      ? "A regra 8 tem produto. Confirmar o productId com o cliente e resolver a ambiguidade " +
        "'no 6º mês vs até o 6º mês' (pergunta 43)."
      : "**Regra 8 continua BLOQUEADA POR DADO.** Sem o produto cadastrado não dá para confirmar " +
        "que a oferta existe, verificar se o cliente já a tem, nem precificá-la (pergunta 44).",
  );
}

// ---------------------------------------------------------------------------

async function main() {
  console.log("\n\x1b[1mFASE 0 — Provas de acesso à API Conexa\x1b[0m");
  console.log(`  base: ${BASE_URL}`);
  console.log(`  ritmo: ${REQ_POR_MIN} req/min (teto compartilhado com o financeiro — ADR-0002)`);
  console.log(`  disjuntor: ${MAX_REQ} requisições\n`);

  const provas = [prova1, prova2, prova3, prova4, prova5, extraPanteao];
  for (const p of provas) {
    try {
      await p();
    } catch (err) {
      registrar(p.name, p.name, "FALHOU", `Exceção: ${err?.message ?? err}`, "Investigar.");
      if (String(err?.message ?? "").includes("Disjuntor")) break;
    }
  }

  const caminho = resolve(RAIZ, "docs/context/fase-0-resultado.md");
  mkdirSync(dirname(caminho), { recursive: true });
  writeFileSync(caminho, montarRelatorio(), "utf8");

  console.log(`\n  ${requisicoesFeitas} requisições feitas.`);
  console.log(`  Relatório: docs/context/fase-0-resultado.md\n`);

  const falhou = resultados.filter((r) => r.veredito === "FALHOU");
  if (falhou.length) {
    console.log(`  \x1b[31m${falhou.length} prova(s) FALHARAM — o escopo muda. Ler o relatório.\x1b[0m\n`);
  }
}

function montarRelatorio() {
  const linhas = [
    "# Fase 0 — Resultado das provas de acesso",
    "",
    `Executado em ${new Date().toISOString()} · ${requisicoesFeitas} requisições · base \`${BASE_URL}\``,
    "",
    "> ⚠ Este arquivo é ignorado pelo git — pode conter dado de cliente real.",
    "> Transcrever as CONCLUSÕES para `progress.md` e `perguntas-abertas.md`, não o arquivo inteiro.",
    "",
    "| Prova | Veredito |",
    "|---|---|",
    ...resultados.map((r) => `| ${r.n} — ${r.titulo} | **${r.veredito}** |`),
    "",
    "---",
    "",
  ];

  for (const r of resultados) {
    linhas.push(
      `## Prova ${r.n} — ${r.titulo}`,
      "",
      `**Veredito:** ${r.veredito}`,
      "",
      "**Medição.**",
      "",
      "```",
      r.detalhe ?? "(sem detalhe)",
      "```",
      "",
      "**Consequência.**",
      "",
      r.consequencia ?? "(sem consequência registrada)",
      "",
      "---",
      "",
    );
  }

  linhas.push(
    "## Próximo passo",
    "",
    "1. Transcrever as conclusões para `progress.md`.",
    "2. Atualizar `perguntas-abertas.md` — marcar o que foi respondido pela medição.",
    "3. Se a Prova 1 falhou, reordenar o `roadmap.md` para as regras de contrato (1, 6, 7, 8).",
    "4. Só então começar a Fase 1.",
    "",
  );

  return linhas.join("\n");
}

main().catch((err) => {
  console.error("\n  ERRO FATAL:", err?.message ?? err, "\n");
  process.exit(1);
});
