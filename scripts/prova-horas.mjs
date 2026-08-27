#!/usr/bin/env node
/**
 * PROVA DAS HORAS — de onde vem a hora que a nossa concessao nao conhece.
 *
 * ============================ SOMENTE LEITURA ============================
 * `pedir()` tem o metodo fixo em GET e nao expoe `method` nem `body`.
 * ========================================================================
 *
 * Historico das hipoteses, todas mortas contra dado:
 *   1. "a cota vem do plano, nao do contrato" — corrigido, o defeito sobreviveu;
 *   2. "`validityType` != Monthly e descartado em silencio" — medido: os 24
 *      planos com cota usam Monthly, os 24. Morta;
 *   3. "produto de pacote de horas declara as horas" — medido: `/products` nao
 *      tem campo de quantidade nenhum. Morta.
 *
 * Hipotese 4, a que este script testa: a hora vem de **pacote recorrente**
 * (`recurringSales.packageId`). O indicio bruto e forte — `packageId 43, qty 2`
 * aparece em tres clientes independentes aos quais faltam exatamente 4h — mas
 * indicio nao e prova. Falta:
 *
 *   a) medir no CICLO CERTO. A comparacao anterior usou 60 dias de consumo
 *      contra uma cota mensal, o que infla todo mundo e transformaria cliente
 *      correto em "impossivel". O ciclo e de 30 dias a partir do aniversario
 *      do contrato;
 *   b) testar a CORRELACAO nos dois sentidos, numa 2x2. "Todo impossivel tem
 *      pacote" so vale se "quem tem pacote nem sempre e impossivel" e falso do
 *      jeito certo — senao o pacote nao explica nada, so acompanha.
 *
 * Uso:  node --env-file=.env scripts/prova-horas.mjs
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASE_URL = (process.env.CONEXA_BASE_URL ?? "").replace(/\/$/, "");
const TOKEN = process.env.CONEXA_API_TOKEN ?? "";
// Medido: corte na req #58 de uma rajada sustentada, com `x-rate-limit-reset`.
// O teto de 60/min e real — a rajada curta de 12s so nao tinha chegado nele.
const REQ_POR_MIN = Number(process.env.PROVA_RITMO ?? 40);
const MAX_REQ = Number(process.env.PROVA_MAX_REQ ?? 300);

if (!TOKEN || !BASE_URL) {
  console.error("\n  ERRO: CONEXA_API_TOKEN / CONEXA_BASE_URL ausentes.\n");
  process.exit(1);
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const intervaloMs = Math.ceil((60_000 / REQ_POR_MIN) * 1.05);
let ultima = 0;
let feitas = 0;

async function pedir(caminho, query = {}) {
  if (feitas >= MAX_REQ) throw new Error(`DISJUNTOR: ${MAX_REQ} requisicoes`);
  const espera = ultima + intervaloMs - Date.now();
  if (espera > 0) await dormir(espera);
  ultima = Date.now();
  feitas++;
  const url = new URL(`${BASE_URL}/${caminho.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) for (const x of v) url.searchParams.append(k, String(x));
    else url.searchParams.set(k, String(v));
  }
  let resp;
  try {
    resp = await fetch(url, {
      method: "GET", // fixo — somente leitura
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" },
    });
  } catch (e) {
    return { ok: false, status: 0, dados: null };
  }
  const texto = await resp.text();
  let corpo = null;
  try {
    corpo = texto ? JSON.parse(texto) : null;
  } catch {
    corpo = null;
  }
  return {
    ok: resp.ok,
    status: resp.status,
    dados: corpo,
    reset: resp.headers.get("x-rate-limit-reset") ?? resp.headers.get("retry-after"),
  };
}

function itens(d) {
  if (Array.isArray(d)) return d;
  if (!d || typeof d !== "object") return [];
  for (const k of ["data", "items", "results", "records"]) if (Array.isArray(d[k])) return d[k];
  for (const v of Object.values(d)) if (Array.isArray(v)) return v;
  return [];
}

/** Pagina ate o fim. Espera o reset em 429 — 429 nao e "acabou a lista". */
async function paginar(caminho, query = {}, teto = 5000) {
  const todos = [];
  for (let off = 0; off < teto; off += 100) {
    let r = await pedir(caminho, { ...query, limit: 100, offset: off });
    for (let t = 0; r.status === 429 && t < 4; t++) {
      const s = Number(r.reset ?? 15);
      diz(`> 429 em \`${caminho}\` offset ${off} — esperando ${s}s`);
      await dormir((Number.isFinite(s) ? s : 15) * 1000 + 500);
      r = await pedir(caminho, { ...query, limit: 100, offset: off });
    }
    if (!r.ok) {
      diz(`> **ABORTADO** \`${caminho}\` offset ${off}: status ${r.status} — lista parcial.`);
      return { ok: false, todos };
    }
    const lote = itens(r.dados);
    todos.push(...lote);
    const hasNext = r.dados && r.dados.pagination ? r.dados.pagination.hasNext : false;
    if (lote.length < 100 || !hasNext) break;
  }
  return { ok: true, todos };
}

const rel = [];
const diz = (s = "") => {
  console.log(s);
  rel.push(s);
};

/**
 * Inicio do ciclo vigente: o aniversario mensal do contrato mais recente que
 * ja passou. Ver `docs/context/` — 30 dias do aniversario, sem acumulo.
 */
function inicioDoCiclo(startDate, hoje) {
  const s = new Date(`${String(startDate).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(s.getTime())) return null;
  const dia = s.getUTCDate();
  const c = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), dia));
  if (c > hoje) c.setUTCMonth(c.getUTCMonth() - 1);
  return c;
}

function horasDe(b) {
  if (!b.startTime || !b.finalTime) return null;
  const a = Date.parse(b.startTime);
  const z = Date.parse(b.finalTime);
  if (!Number.isFinite(a) || !Number.isFinite(z) || z <= a) return null;
  return (z - a) / 3_600_000;
}

(async () => {
  diz("# Prova das horas — a fonte da hora desconhecida");
  diz(`\nBase: \`${BASE_URL}\` · ritmo ${REQ_POR_MIN} req/min\n`);
  const hoje = new Date();
  const t0 = Date.now();

  try {
    // ── Concessao conhecida ────────────────────────────────────────────────
    const rp = await paginar("plans", { isActive: 1 });
    const cotaDoPlano = new Map();
    for (const p of rp.todos) {
      const hq = Array.isArray(p.hourQuotas) ? p.hourQuotas : [];
      if (!hq.length) continue;
      cotaDoPlano.set(p.planId, {
        nome: p.name,
        cota: hq.reduce((a, q) => a + (Number(q.quantity) || 0), 0),
      });
    }
    const rc = await paginar("contracts", {
      isActive: 1,
      "planId[]": [...cotaDoPlano.keys()], // COM colchete — sem ele a API da 400
    });
    const contratos = rc.todos.filter((c) => c.isActive && cotaDoPlano.has(c.planId));

    const porCliente = new Map();
    for (const c of contratos) {
      if (c.customerId == null) continue;
      const doPlano = cotaDoPlano.get(c.planId);
      const hq = Array.isArray(c.hourPlanQuota) ? c.hourPlanQuota : [];
      const doContrato = hq.length ? hq.reduce((a, q) => a + (Number(q.quantity) || 0), 0) : null;
      const ini = inicioDoCiclo(c.startDate, hoje);
      const at = porCliente.get(c.customerId) ?? { concedido: 0, ciclo: null, planos: [] };
      at.concedido += doContrato ?? doPlano.cota;
      // Varios contratos: o ciclo mais recente e o que vale para a leitura.
      if (ini && (!at.ciclo || ini > at.ciclo)) at.ciclo = ini;
      at.planos.push(doPlano.nome);
      porCliente.set(c.customerId, at);
    }
    diz(`Planos ativos com cota: **${cotaDoPlano.size}** · contratos: **${contratos.length}** · clientes: **${porCliente.size}**\n`);

    // ── Pacotes recorrentes ────────────────────────────────────────────────
    const rr = await paginar("recurringSales", { isActive: 1 });
    const pacotesPor = new Map();
    for (const x of rr.todos) {
      if (x.customerId == null || x.packageId == null) continue;
      const l = pacotesPor.get(x.customerId) ?? [];
      l.push({ packageId: x.packageId, qty: Number(x.quantity) || 0 });
      pacotesPor.set(x.customerId, l);
    }

    // ── Consumo NO CICLO, cliente a cliente ────────────────────────────────
    // A janela e por cliente (aniversario diferente), entao o lote pega o ciclo
    // mais antigo do grupo e filtra em memoria.
    const ids = [...porCliente.keys()];
    const maisAntigo = ids
      .map((i) => porCliente.get(i).ciclo)
      .filter(Boolean)
      .sort((a, b) => a - b)[0];
    const desde = (maisAntigo ?? new Date(Date.now() - 40 * 86_400_000)).toISOString().slice(0, 10);

    const abatidoPor = new Map();
    const LOTE = 40;
    for (let i = 0; i < ids.length; i += LOTE) {
      const rb = await paginar("room/bookings", {
        "customerId[]": ids.slice(i, i + LOTE),
        createdAtFrom: `${desde}T00:00:00-03:00`,
      });
      for (const b of rb.todos) {
        if (!b.isActive || b.cancellationReason) continue;
        if (b.status !== "deductedFromQuota") continue;
        const cli = porCliente.get(b.customerId);
        if (!cli || !cli.ciclo) continue;
        const quando = Date.parse(b.startTime ?? b.createdAt);
        if (!Number.isFinite(quando) || quando < cli.ciclo.getTime()) continue; // fora do ciclo
        const h = horasDe(b);
        if (h === null) continue;
        abatidoPor.set(b.customerId, (abatidoPor.get(b.customerId) ?? 0) + h);
      }
    }

    // ── A 2x2 ──────────────────────────────────────────────────────────────
    let a = 0, b = 0, c = 0, d = 0; // impossivel×pacote
    const detalhe = [];
    for (const [id, v] of porCliente) {
      const ab = abatidoPor.get(id) ?? 0;
      const impossivel = ab > v.concedido + 0.01;
      const temPacote = pacotesPor.has(id);
      if (impossivel && temPacote) a++;
      else if (impossivel && !temPacote) b++;
      else if (!impossivel && temPacote) c++;
      else d++;
      if (impossivel)
        detalhe.push({
          id,
          falta: ab - v.concedido,
          abatido: ab,
          concedido: v.concedido,
          pacotes: pacotesPor.get(id) ?? [],
          plano: v.planos[0],
        });
    }

    diz("## A correlacao, nos dois sentidos\n");
    diz("Consumo medido **no ciclo de aniversario de cada contrato**, nao numa janela fixa.\n");
    diz("| | tem pacote recorrente | sem pacote |");
    diz("| --- | --- | --- |");
    diz(`| **abatido > concedido** | **${a}** | ${b} |`);
    diz(`| conta fecha | ${c} | ${d} |`);
    diz("");
    if (b === 0 && a > 0) {
      diz(
        `**Nenhum cliente estoura a cota sem ter pacote recorrente** (${b} casos). A hora\n` +
          `desconhecida vem de \`recurringSales.packageId\` — hipotese 4 sustentada.`,
      );
    } else if (b > 0) {
      diz(
        `⚠ **${b} cliente(s) estouram a cota SEM pacote.** O pacote explica parte, nao tudo —\n` +
          `existe uma quinta fonte ainda desconhecida. Ver o detalhe abaixo.`,
      );
    }
    diz("");

    // ── Quantas horas cada pacote concede, inferido pelo residuo ───────────
    diz("## Quanto cada pacote concede (inferido pelo residuo)\n");
    diz("| cliente | plano | concedido | abatido | falta | pacotes (id x qty) |");
    diz("| --- | --- | --- | --- | --- | --- |");
    for (const x of detalhe.sort((p, q) => q.falta - p.falta).slice(0, 20)) {
      const pk = x.pacotes.map((p) => `${p.packageId}x${p.qty}`).join(", ") || "—";
      diz(
        `| #${x.id} | ${x.plano} | ${x.concedido}h | ${x.abatido.toFixed(1)}h | **${x.falta.toFixed(1)}h** | ${pk} |`,
      );
    }
    diz("");

    // Residuo por pacote, so onde o cliente tem UM unico pacote — caso limpo.
    const porPacote = new Map();
    for (const x of detalhe) {
      if (x.pacotes.length !== 1) continue;
      const p = x.pacotes[0];
      if (!p.qty) continue;
      const l = porPacote.get(p.packageId) ?? [];
      l.push(x.falta / p.qty);
      porPacote.set(p.packageId, l);
    }
    if (porPacote.size) {
      diz("Clientes com **um unico pacote** — o residuo dividido pela quantidade estima a hora/unidade:\n");
      diz("| packageId | n | horas por unidade (min–max) |");
      diz("| --- | --- | --- |");
      for (const [pid, l] of [...porPacote].sort((x, y) => y[1].length - x[1].length)) {
        const mn = Math.min(...l).toFixed(1);
        const mx = Math.max(...l).toFixed(1);
        diz(`| \`${pid}\` | ${l.length} | ${mn === mx ? `**${mn}h**` : `${mn} – ${mx}`} |`);
      }
      diz(
        "\n> Um intervalo APERTADO (min = max) em varios clientes independentes e evidencia forte.\n" +
          "> Um intervalo largo significa que o residuo tem outra causa junto — e ai o numero\n" +
          "> nao serve para alimentar regra nenhuma.",
      );
    }

    diz(
      "\n## O limite\n\n" +
        "`GET /packages`, `/package/:id` e `/hourPackages` respondem **404** com este token.\n" +
        "O conteudo do pacote — quantas horas ele concede — **nao e obtivel pela API**. O residuo\n" +
        "acima e inferencia estatistica, nao dado: serve para pedir a liberacao ao admin do\n" +
        "Conexa com numero na mao, **nao** para virar constante no codigo.",
    );
  } catch (e) {
    diz(`\n> **INTERROMPIDO:** ${e.message}`);
  }

  diz(`\n---\n\nRequisicoes: **${feitas}** · duracao **${((Date.now() - t0) / 1000).toFixed(0)}s**`);
  const saida = resolve(RAIZ, "docs/context/prova-horas-resultado.md");
  mkdirSync(dirname(saida), { recursive: true });
  writeFileSync(saida, rel.join("\n") + "\n", "utf8");
  console.log(`\n→ ${saida}`);
})();
