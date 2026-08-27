#!/usr/bin/env node
/**
 * PROVA DE COBERTURA DA API CONEXA v2 — validação contra a fonte, sob carga.
 *
 * ============================ SOMENTE LEITURA ============================
 * `pedir()` tem o método fixo em GET e não expõe `method` nem `body`. Não
 * existe caminho de código capaz de escrever. O token é de admin: um POST
 * acidental alteraria dado real da empresa.
 * ========================================================================
 *
 * POR QUE ESTE SCRIPT EXISTE
 * O sistema tinha quatro clientes com `abatido > concedido` — o ERP descontou
 * mais horas do que a cota que conhecemos. Eu já persegui uma hipótese (a cota
 * vinha do plano, não do contrato), corrigi, e o defeito sobreviveu. Toda
 * hipótese seguinte tem que morrer contra dado, não contra leitura de código.
 *
 * Seis blocos, cada um com uma pergunta fechada:
 *   A  Quais endpoints o nosso token realmente alcança? (contrato + permissão)
 *   B  Qual é o teto real de requisições? (stress, com disjuntor)
 *   C  Como a cota de horas é declarada, em TODOS os planos?
 *   D  `recurringSales` existe e concede horas?
 *   E  Quanto a API declara que tem, por recurso?
 *   F  Que campos a API devolve, recurso a recurso?
 *
 * Uso:  node --env-file=.env scripts/prova-api-cobertura.mjs [--stress]
 *
 * `--stress` liga o bloco B, que DE PROPÓSITO estoura o ritmo para descobrir
 * onde a API corta. Sem a flag, o script respeita o ritmo configurado.
 *
 * Saída: docs/context/prova-api-resultado.md (fora do git — tem dado real).
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASE_URL = (process.env.CONEXA_BASE_URL ?? "").replace(/\/$/, "");
const TOKEN = process.env.CONEXA_API_TOKEN ?? "";
const REQ_POR_MIN = Number(process.env.CONEXA_RATE_LIMIT_PER_MIN ?? 45);
const MAX_REQ = Number(process.env.PROVA_MAX_REQ ?? 400);
const STRESS = process.argv.includes("--stress");

if (!TOKEN || !BASE_URL) {
  console.error("\n  ERRO: CONEXA_API_TOKEN / CONEXA_BASE_URL ausentes.");
  console.error("  Rode com:  node --env-file=.env scripts/prova-api-cobertura.mjs\n");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Cliente — GET fixo, espaçado, com disjuntor global.
// ---------------------------------------------------------------------------
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const intervaloMs = Math.ceil((60_000 / REQ_POR_MIN) * 1.05);
let ultima = 0;
let feitas = 0;

function montarUrl(caminho, query = {}) {
  const url = new URL(`${BASE_URL}/${caminho.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    // A Conexa exige o parâmetro REPETIDO para arrays: id[]=1&id[]=2.
    if (Array.isArray(v)) for (const x of v) url.searchParams.append(k, String(x));
    else url.searchParams.set(k, String(v));
  }
  return url.toString();
}

async function pedir(caminho, query = {}, { semEspera = false } = {}) {
  if (feitas >= MAX_REQ) throw new Error(`DISJUNTOR: ${MAX_REQ} requisicoes atingidas`);
  if (!semEspera) {
    const espera = ultima + intervaloMs - Date.now();
    if (espera > 0) await dormir(espera);
  }
  ultima = Date.now();
  feitas++;
  const t0 = Date.now();
  const url = montarUrl(caminho, query);
  let resp;
  try {
    resp = await fetch(url, {
      method: "GET", // fixo — ver o bloco SOMENTE LEITURA no topo
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" },
    });
  } catch (e) {
    return { ok: false, status: 0, erro: String(e), dados: null, headers: {}, ms: Date.now() - t0 };
  }
  const ms = Date.now() - t0;
  const headers = {};
  for (const h of ["x-ratelimit-limit", "x-ratelimit-remaining", "retry-after"]) {
    const v = resp.headers.get(h);
    if (v !== null) headers[h] = v;
  }
  let corpo = null;
  const texto = await resp.text();
  try {
    corpo = texto ? JSON.parse(texto) : null;
  } catch {
    corpo = { _naoJson: texto.slice(0, 200) };
  }
  return { ok: resp.ok, status: resp.status, dados: corpo, headers, ms };
}

/** Extrai a lista de itens seja qual for o envelope. */
function itens(dados) {
  if (Array.isArray(dados)) return dados;
  if (!dados || typeof dados !== "object") return [];
  for (const chave of ["data", "items", "results", "records"]) {
    if (Array.isArray(dados[chave])) return dados[chave];
  }
  for (const v of Object.values(dados)) if (Array.isArray(v)) return v;
  return [];
}

/** Uniao das chaves observadas numa amostra — o contrato REAL, nao o suposto. */
function chavesDe(lista, limite = 300) {
  const set = new Set();
  for (const it of lista.slice(0, limite)) {
    if (it && typeof it === "object") for (const k of Object.keys(it)) set.add(k);
  }
  return [...set].sort();
}

const rel = [];
const diz = (s = "") => {
  console.log(s);
  rel.push(s);
};

// ---------------------------------------------------------------------------
// BLOCO A — alcance real do token
// ---------------------------------------------------------------------------
/**
 * ⚠ Um 404 aqui NAO significa "nao existe". O Conexa responde 404 para recurso
 * existente mas nao liberado ao token — foi assim que descobrimos que salas e
 * espacos somem de /products. Por isso a coluna registra o status cru.
 */
const RECURSOS = [
  { caminho: "customers", usamos: true },
  { caminho: "contracts", usamos: true },
  { caminho: "charges", usamos: true },
  { caminho: "sales", usamos: true },
  { caminho: "room/bookings", usamos: true },
  { caminho: "companies", usamos: true },
  { caminho: "serviceCategories", usamos: true },
  { caminho: "plans", usamos: true },
  { caminho: "products", usamos: true },
  { caminho: "recurringSales", usamos: false },
  { caminho: "rooms", usamos: false },
  { caminho: "spaces", usamos: false },
  { caminho: "packages", usamos: false },
  { caminho: "hourPackages", usamos: false },
  { caminho: "customerHours", usamos: false },
  { caminho: "sellers", usamos: false },
  { caminho: "users", usamos: false },
  { caminho: "invoices", usamos: false },
];

async function blocoA() {
  diz("\n## Bloco A — alcance real do token\n");
  diz("| recurso | usamos | status | itens | paginacao | campos |");
  diz("| --- | --- | --- | --- | --- | --- |");
  const contratos = {};
  for (const r of RECURSOS) {
    const resp = await pedir(r.caminho, { limit: 50, offset: 0 });
    const lista = itens(resp.dados);
    const pag = resp.dados && resp.dados.pagination ? "sim" : "nao";
    const ks = chavesDe(lista);
    if (resp.ok && lista.length) contratos[r.caminho] = { chaves: ks, exemplo: lista[0] };
    diz(
      `| \`${r.caminho}\` | ${r.usamos ? "sim" : "**nao**"} | ${resp.status} | ${lista.length} | ${pag} | ${ks.length} |`,
    );
  }
  return contratos;
}

// ---------------------------------------------------------------------------
// BLOCO B — teto real, sob stress
// ---------------------------------------------------------------------------
/**
 * ⚠ O ritmo de 60 req/min e heranca de leitura de documentacao e de UMA medicao
 * passiva. Aqui a pergunta e outra: onde a API efetivamente CORTA, e o que ela
 * devolve ao cortar. Um sistema que nao sabe reconhecer o proprio 429 vira uma
 * carga que falha em silencio as 3 da manha.
 */
async function blocoB() {
  diz("\n## Bloco B — teto real de requisicoes (stress)\n");
  if (!STRESS) {
    diz("_Pulado — rode com `--stress` para medir. O bloco estoura o ritmo de proposito._");
    return null;
  }
  const RAJADA = 40;
  diz(`Disparando ${RAJADA} requisicoes **sem espacamento** contra \`customers?limit=1\`.\n`);
  const t0 = Date.now();
  const res = [];
  for (let i = 0; i < RAJADA; i++) {
    if (feitas >= MAX_REQ) break;
    res.push(await pedir("customers", { limit: 1, offset: i }, { semEspera: true }));
  }
  const dur = (Date.now() - t0) / 1000;
  const por = {};
  for (const r of res) por[r.status] = (por[r.status] ?? 0) + 1;
  const cortes = res.filter((r) => r.status === 429);
  const lat = res.map((r) => r.ms).filter((x) => typeof x === "number").sort((a, b) => a - b);
  const p = (q) => lat[Math.min(lat.length - 1, Math.floor(lat.length * q))] ?? 0;

  diz(
    `- Enviadas: **${res.length}** em **${dur.toFixed(1)}s** → ${((res.length / dur) * 60).toFixed(0)} req/min efetivos`,
  );
  diz(`- Status: ${Object.entries(por).map(([k, v]) => `\`${k}\`x${v}`).join(", ")}`);
  diz(`- Latencia: p50 **${p(0.5)}ms**, p95 **${p(0.95)}ms**, max **${lat.at(-1)}ms**`);
  if (cortes.length) {
    const primeiro = res.findIndex((r) => r.status === 429);
    diz(
      `- **Cortou na requisicao #${primeiro + 1}** (~${(((primeiro + 1) / dur) * 60).toFixed(0)} req/min)`,
    );
    diz(`- Headers do corte: \`${JSON.stringify(cortes[0].headers)}\``);
  } else {
    diz(
      `- **Nenhum 429.** A API aguentou a rajada inteira — o teto esta acima de ${((res.length / dur) * 60).toFixed(0)} req/min.`,
    );
  }
  const hs = res.map((r) => r.headers).filter((h) => Object.keys(h).length);
  diz(
    `- Headers de rate limit: ${hs.length ? `\`${JSON.stringify(hs[0])}\`` : "**nenhum** — a API nao informa quanto resta"}`,
  );
  return { enviadas: res.length, dur, por, cortou: cortes.length > 0 };
}

// ---------------------------------------------------------------------------
// BLOCO C — como a cota e declarada, em TODOS os planos
// ---------------------------------------------------------------------------
/**
 * A pergunta que derruba a hipotese: o nosso conversor soma so
 * `validityType === "Monthly"` e DESCARTA o resto em silencio. Se existir um
 * unico plano com cota Weekly ou Daily, os saldos impossiveis estao explicados
 * — e a correcao e de conversao, nao de carga nova.
 */
async function blocoC() {
  diz("\n## Bloco C — estrutura da cota de horas, no universo de planos\n");
  const todos = [];
  for (let off = 0; off < 3000; off += 100) {
    const r = await pedir("plans", { limit: 100, offset: off });
    if (!r.ok) {
      diz(`> Falha ao paginar planos no offset ${off}: status ${r.status}`);
      break;
    }
    const lote = itens(r.dados);
    todos.push(...lote);
    const hasNext = r.dados && r.dados.pagination ? r.dados.pagination.hasNext : false;
    if (lote.length < 100 || !hasNext) break;
  }
  diz(`Planos lidos da API: **${todos.length}**\n`);

  const porValidity = {};
  const comProductQuotas = [];
  const misturados = [];
  let comHourQuotas = 0;
  let comQuantityNulo = 0;
  const camposDeCota = new Set();

  for (const p of todos) {
    const hq = Array.isArray(p.hourQuotas) ? p.hourQuotas : [];
    const pq = Array.isArray(p.productQuotas) ? p.productQuotas : [];
    if (pq.length)
      comProductQuotas.push({ id: p.planId ?? p.id, nome: p.name, n: pq.length, ex: pq[0] });
    if (!hq.length) continue;
    comHourQuotas++;
    const tipos = new Set();
    for (const q of hq) {
      for (const k of Object.keys(q ?? {})) camposDeCota.add(k);
      const t = q.validityType ?? "(ausente)";
      porValidity[t] = (porValidity[t] ?? 0) + 1;
      tipos.add(t);
      if (q.quantity === null || q.quantity === undefined) comQuantityNulo++;
    }
    // O caso que quebra o nosso conversor: Monthly convivendo com outro tipo.
    const naoMensais = [...tipos].filter((t) => t !== "Monthly");
    if (tipos.has("Monthly") && naoMensais.length) {
      misturados.push({ id: p.planId ?? p.id, nome: p.name, tipos: [...tipos], hq });
    }
  }

  diz(`- Planos com \`hourQuotas\`: **${comHourQuotas}**`);
  diz(`- Campos de uma linha de cota: \`${[...camposDeCota].sort().join("`, `")}\``);
  diz(`- Distribuicao de \`validityType\`: \`${JSON.stringify(porValidity)}\``);
  diz(`- Linhas com \`quantity\` nulo: **${comQuantityNulo}**`);
  diz(`- Planos com \`productQuotas\`: **${comProductQuotas.length}**`);
  if (comProductQuotas.length) diz(`  - exemplo: \`${JSON.stringify(comProductQuotas[0])}\``);
  diz("");
  if (misturados.length) {
    diz(
      `### ⚠ ${misturados.length} plano(s) misturam Monthly com outro tipo — o nosso conversor DESCARTA o resto\n`,
    );
    for (const m of misturados.slice(0, 15)) {
      diz(`- **${m.nome}** (#${m.id}) — tipos: ${m.tipos.join(", ")}`);
      for (const q of m.hq)
        diz(
          `  - \`${q.validityType ?? "(ausente)"}\` x ${q.quantity} — ${q.name ?? ""} (spaceId ${q.spaceId ?? "-"}, groupId ${q.groupId ?? "-"})`,
        );
    }
  } else {
    diz(
      "**Nenhum plano mistura tipos de validade.** A hipotese do descarte silencioso esta MORTA — a cota nao vem dai.",
    );
  }
  return { totalPlanos: todos.length, porValidity, misturados, comProductQuotas };
}

// ---------------------------------------------------------------------------
// BLOCO D — recurringSales
// ---------------------------------------------------------------------------
async function blocoD() {
  diz("\n## Bloco D — `recurringSales` (nunca sincronizado)\n");
  const todas = [];
  for (let off = 0; off < 3000; off += 100) {
    const r = await pedir("recurringSales", { limit: 100, offset: off });
    if (!r.ok) {
      diz(`> status ${r.status} no offset ${off} — ${JSON.stringify(r.dados).slice(0, 200)}`);
      return null;
    }
    const lote = itens(r.dados);
    todas.push(...lote);
    const hasNext = r.dados && r.dados.pagination ? r.dados.pagination.hasNext : false;
    if (lote.length < 100 || !hasNext) break;
  }
  diz(`Assinaturas recorrentes: **${todas.length}**`);
  if (!todas.length) return { total: 0 };
  diz(`Campos: \`${chavesDe(todas).join("`, `")}\`\n`);
  const ativas = todas.filter((r) => r.isActive);
  const freq = {};
  for (const r of todas) {
    const f = r.frequency ?? "(nulo)";
    freq[f] = (freq[f] ?? 0) + 1;
  }
  const clientes = new Set(todas.map((r) => r.customerId).filter((x) => x != null));
  const produtos = new Set(todas.map((r) => r.productId).filter((x) => x != null));
  const comContrato = todas.filter((r) => r.recurringSaleContractId != null);
  diz(`- Ativas: **${ativas.length}** de ${todas.length}`);
  diz(`- Clientes distintos: **${clientes.size}** | produtos distintos: **${produtos.size}**`);
  diz(`- Com \`recurringSaleContractId\`: **${comContrato.length}**`);
  diz(`- Frequencia: \`${JSON.stringify(freq)}\``);
  diz(`- Exemplo: \`${JSON.stringify(todas[0])}\``);
  return { total: todas.length, ativas: ativas.length, produtos: [...produtos], todas };
}

// ---------------------------------------------------------------------------
// BLOCO E — quanto a API declara que tem
// ---------------------------------------------------------------------------
async function blocoE() {
  diz("\n## Bloco E — total declarado pela API\n");
  diz("| recurso | total | paginacao crua |");
  diz("| --- | --- | --- |");
  const totais = {};
  const alvos = [
    "customers",
    "contracts",
    "charges",
    "sales",
    "room/bookings",
    "plans",
    "products",
    "recurringSales",
  ];
  for (const nome of alvos) {
    const r = await pedir(nome, { limit: 1, offset: 0 });
    const pag = (r.dados && r.dados.pagination) || {};
    const total = pag.total ?? pag.totalItems ?? pag.count ?? null;
    totais[nome] = total;
    diz(`| \`${nome}\` | ${total ?? "—"} | \`${JSON.stringify(pag)}\` |`);
  }
  return totais;
}

// ---------------------------------------------------------------------------
// BLOCO F — contrato de campos por recurso
// ---------------------------------------------------------------------------
async function blocoF(contratos) {
  diz("\n## Bloco F — campos devolvidos, recurso a recurso\n");
  for (const [nome, c] of Object.entries(contratos)) {
    diz(`- **\`${nome}\`** (${c.chaves.length}): \`${c.chaves.join("`, `")}\``);
  }
}

// ---------------------------------------------------------------------------
(async () => {
  diz("# Prova de cobertura da API Conexa v2");
  diz(
    `\nBase: \`${BASE_URL}\` · ritmo ${REQ_POR_MIN} req/min · disjuntor ${MAX_REQ} req · stress: ${STRESS ? "**ligado**" : "desligado"}\n`,
  );
  const t0 = Date.now();
  let contratos = {};
  try {
    contratos = await blocoA();
    await blocoB();
    await blocoC();
    await blocoD();
    await blocoE();
    await blocoF(contratos);
  } catch (e) {
    diz(`\n> **INTERROMPIDO:** ${e.message}`);
  }
  diz(`\n---\n\nRequisicoes gastas: **${feitas}** · duracao **${((Date.now() - t0) / 1000).toFixed(0)}s**`);
  const saida = resolve(RAIZ, "docs/context/prova-api-resultado.md");
  mkdirSync(dirname(saida), { recursive: true });
  writeFileSync(saida, rel.join("\n") + "\n", "utf8");
  console.log(`\n→ ${saida}`);
})();
