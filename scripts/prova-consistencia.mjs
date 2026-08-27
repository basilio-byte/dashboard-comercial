#!/usr/bin/env node
/**
 * PROVA DE CONSISTENCIA — o que a nossa estrategia de carga NAO ve.
 *
 * ============================ SOMENTE LEITURA ============================
 * `pedir()` tem o metodo fixo em GET e nao expoe `method` nem `body`.
 * ========================================================================
 *
 * Tres perguntas fechadas, todas respondidas contra a API, nenhuma contra o
 * espelho:
 *
 *   1. DERIVA DE ESTADO — a carga recorta por `createdAt` e o incremental so
 *      revisita ~3 meses. Um registro antigo que MUDA hoje (cliente bloqueado,
 *      reserva cancelada, contrato encerrado) nunca mais e relido. Nenhuma rota
 *      da API expoe `updatedAtFrom` — medido nas 43 rotas GET da colecao — mas
 *      `updatedAt` VEM na resposta. Entao da para medir o tamanho do buraco:
 *      quantos registros de janelas antigas foram tocados depois.
 *
 *   2. HORAS IMPOSSIVEIS — `abatido > concedido` em 4 clientes. `abatido` e
 *      veredito do proprio ERP (`status: "deductedFromQuota"`), logo quem esta
 *      errado e a NOSSA concessao. Ja matei duas hipoteses (cota do plano vs.
 *      do contrato; `validityType` descartado). Esta prova refaz a conta
 *      inteira pela API e mostra o cliente cru quando nao fecha.
 *
 *   3. PACOTES — `recurringSales` tem `packageId`, e `/packages` responde 404.
 *      Se a hora extra vem de pacote, ela e INALCANCAVEL pelo token atual, e
 *      isso e um pedido ao admin do Conexa, nao uma tarefa de codigo.
 *
 * Uso:  node --env-file=.env scripts/prova-consistencia.mjs
 * Saida: docs/context/prova-consistencia-resultado.md (fora do git).
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASE_URL = (process.env.CONEXA_BASE_URL ?? "").replace(/\/$/, "");
const TOKEN = process.env.CONEXA_API_TOKEN ?? "";
// Medido no bloco B da prova de cobertura: 40 req sem espacamento, 202 req/min
// efetivos, ZERO 429. O 15 do .env era chute conservador herdado.
const REQ_POR_MIN = Number(process.env.PROVA_RITMO ?? 90);
const MAX_REQ = Number(process.env.PROVA_MAX_REQ ?? 500);

if (!TOKEN || !BASE_URL) {
  console.error("\n  ERRO: CONEXA_API_TOKEN / CONEXA_BASE_URL ausentes.\n");
  process.exit(1);
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const intervaloMs = Math.ceil((60_000 / REQ_POR_MIN) * 1.05);
let ultima = 0;
let feitas = 0;

function montarUrl(caminho, query = {}) {
  const url = new URL(`${BASE_URL}/${caminho.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) for (const x of v) url.searchParams.append(k, String(x));
    else url.searchParams.set(k, String(v));
  }
  return url.toString();
}

async function pedir(caminho, query = {}) {
  if (feitas >= MAX_REQ) throw new Error(`DISJUNTOR: ${MAX_REQ} requisicoes`);
  const espera = ultima + intervaloMs - Date.now();
  if (espera > 0) await dormir(espera);
  ultima = Date.now();
  feitas++;
  let resp;
  try {
    resp = await fetch(montarUrl(caminho, query), {
      method: "GET", // fixo — somente leitura
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" },
    });
  } catch (e) {
    return { ok: false, status: 0, dados: null, erro: String(e) };
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

/**
 * Pagina ate o fim, respeitando `hasNext`.
 *
 * ⚠ Espera o reset em vez de devolver lista parcial. A versao anterior tratava
 * 429 como fim da pagina e devolvia `{ok:false, todos:[]}` — e o chamador,
 * lendo so `todos`, exibia "0 planos com cota" logo depois de exibir 18. Um
 * limite de taxa lido como ausencia de dado e a forma mais rapida de concluir
 * o contrario do que o dado diz.
 */
async function paginar(caminho, query = {}, teto = 5000) {
  const todos = [];
  for (let off = 0; off < teto; off += 100) {
    let r = await pedir(caminho, { ...query, limit: 100, offset: off });
    for (let tent = 0; r.status === 429 && tent < 3; tent++) {
      const reset = Number(r.reset ?? 15);
      diz(`> 429 em \`${caminho}\` offset ${off} — esperando ${reset}s`);
      await dormir((Number.isFinite(reset) ? reset : 15) * 1000 + 500);
      r = await pedir(caminho, { ...query, limit: 100, offset: off });
    }
    if (!r.ok) {
      diz(`> **ABORTADO** \`${caminho}\` no offset ${off}: status ${r.status}. Lista PARCIAL (${todos.length}) — nao use como total.`);
      return { ok: false, status: r.status, todos };
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
const mes = (iso) => (typeof iso === "string" ? iso.slice(0, 7) : null);

// ---------------------------------------------------------------------------
// PROVA 1 — deriva de estado
// ---------------------------------------------------------------------------
async function prova1() {
  diz("\n## Prova 1 — deriva de estado (o que a janela por `createdAt` congela)\n");
  diz(
    "Para cada entidade, uma amostra de registros **criados ha muito tempo**. A pergunta:\n" +
      "quantos foram **alterados depois** da janela em que a nossa carga os colocou?\n" +
      "Esses sao exatamente os registros que o espelho mostra com o estado errado, porque\n" +
      "o incremental so revisita ~3 meses e nenhuma rota aceita `updatedAtFrom`.\n",
  );
  const alvos = [
    // ⚠ 2024, nao 2023: medido — `room/bookings` e `sales` devolvem ZERO antes
    // de 2024. O historico do Conexa comeca ali, e uma amostra vazia teria
    // passado por "nenhuma deriva".
    { nome: "customers", caminho: "customers", de: "2024-01-01", ate: "2024-06-30" },
    { nome: "room/bookings", caminho: "room/bookings", de: "2024-01-01", ate: "2024-06-30" },
    { nome: "sales", caminho: "sales", de: "2024-01-01", ate: "2024-06-30" },
  ];
  diz("| entidade | amostra | tocados depois | % | alteracao mais recente |");
  diz("| --- | --- | --- | --- | --- |");
  const achados = {};
  for (const a of alvos) {
    const r = await pedir(a.caminho, {
      createdAtFrom: `${a.de}T00:00:00-03:00`,
      createdAtTo: `${a.ate}T23:59:59-03:00`,
      limit: 100,
      offset: 0,
    });
    const lista = itens(r.dados);
    if (!lista.length) {
      diz(`| \`${a.nome}\` | 0 | — | — | status ${r.status} |`);
      continue;
    }
    // ⚠ `customers` NAO devolve `updatedAt` — medido, e confirmado pela lista de
    // 35 campos do recurso. Para ele a deriva e literalmente NAO OBSERVAVEL pela
    // API: nem filtro, nem campo. Dizer isso e melhor que exibir 0%.
    const temUpdated = lista.some((x) => x.updatedAt);
    if (!temUpdated) {
      diz(`| \`${a.nome}\` | ${lista.length} | — | — | **nao expoe \`updatedAt\`** |`);
      achados[a.nome] = { amostra: lista.length, tocados: null, exemplos: [] };
      continue;
    }
    const tocados = lista.filter((x) => {
      const c = mes(x.createdAt);
      const u = mes(x.updatedAt);
      return c && u && u > c;
    });
    const maisRecente = tocados
      .map((x) => x.updatedAt)
      .sort()
      .at(-1);
    achados[a.nome] = { amostra: lista.length, tocados: tocados.length, exemplos: tocados.slice(0, 3) };
    diz(
      `| \`${a.nome}\` | ${lista.length} | **${tocados.length}** | ${((tocados.length / lista.length) * 100).toFixed(0)}% | ${maisRecente ?? "—"} |`,
    );
  }
  diz("");

  // ── DEFASAGEM: quanto tempo DEPOIS o registro muda ──────────────────────
  //
  // ⚠ A tabela acima conta "mudou de mes", que e grosseiro demais para decidir
  // profundidade de revisita: um registro alterado no dia seguinte, se cruzar a
  // virada do mes, conta igual a um alterado um ano depois. O numero que decide
  // `mesesDeRevisita` e a DISTRIBUICAO da defasagem — e ela precisa sair de um
  // script VERSIONADO, nao de uma sonda descartavel, senao o comentario de
  // `janelas.ts` cita uma medicao que ninguem consegue refazer. Foi exatamente
  // o que aconteceu: os numeros daquele comentario sairam de um arquivo em
  // /tmp que nao existe mais.
  diz("### Defasagem entre criacao e alteracao — o que fixa `mesesDeRevisita`");
  diz("");
  diz("| entidade | alterados | p50 | p90 | max | > 90d |");
  diz("| --- | --- | --- | --- | --- | --- |");
  for (const a of alvos) {
    const r = await pedir(a.caminho, {
      createdAtFrom: a.de + "T00:00:00-03:00",
      createdAtTo: a.ate + "T23:59:59-03:00",
      limit: 100,
      offset: 0,
    });
    const lista = itens(r.dados);
    if (!lista.length || !lista.some((x) => x.updatedAt)) {
      diz("| `" + a.nome + "` | — | — | — | — | **nao expoe `updatedAt`** |");
      continue;
    }
    const dias = lista
      .filter((x) => x.createdAt && x.updatedAt)
      .map((x) => (Date.parse(x.updatedAt) - Date.parse(x.createdAt)) / 86400000)
      .filter((d) => d > 0.02) // ~30 min: abaixo disso e a propria escrita
      .sort((x, y) => x - y);
    if (!dias.length) {
      diz("| `" + a.nome + "` | 0 de " + lista.length + " | — | — | — | 0 |");
      continue;
    }
    const q = (f) => dias[Math.min(dias.length - 1, Math.floor(dias.length * f))].toFixed(0);
    const pct = ((dias.length / lista.length) * 100).toFixed(0);
    diz(
      "| `" + a.nome + "` | " + dias.length + "/" + lista.length + " (" + pct + "%) | " +
        q(0.5) + "d | " + q(0.9) + "d | " + dias.at(-1).toFixed(0) + "d | **" +
        dias.filter((d) => d > 90).length + "** |",
    );
  }
  diz("");
  diz("> A coluna **> 90d** e a que decide: e o que escapa de um incremental de 3 meses.");
  diz("> Estes numeros sustentam `mesesDeRevisita` em `src/lib/conexa/janelas.ts`.");
  diz("> Se divergirem da tabela do comentario de la, um dos dois esta velho.");
  diz("");

  // O caso que mais dói: reserva antiga cancelada depois. O espelho a conta como
  // hora consumida para sempre.
  const b = achados["room/bookings"];
  if (b && b.exemplos.length) {
    diz("Exemplo de reserva antiga alterada depois (o espelho congelou o estado de criacao):\n");
    for (const x of b.exemplos) {
      diz(
        `- \`#${x.bookingId}\` criada ${x.createdAt} · alterada **${x.updatedAt}** · status \`${x.status}\` · ativa: ${x.isActive} · cancelamento: ${x.cancellationReason ?? "—"}`,
      );
    }
  }
  return achados;
}

// ---------------------------------------------------------------------------
// PROVA 2 — horas impossiveis, refeitas pela API
// ---------------------------------------------------------------------------
/**
 * ⚠ Refaz a conta SEM o espelho. Se der impossivel aqui tambem, o defeito e da
 * nossa regra de concessao. Se NAO der, o defeito e de carga — e o alvo muda.
 */
async function prova2() {
  diz("\n## Prova 2 — as horas impossiveis, recalculadas direto da API\n");

  const rp = await paginar("plans", { isActive: 1 }); // 1/0, nunca true/false
  const planos = rp.todos.filter((p) => Array.isArray(p.hourQuotas) && p.hourQuotas.length);
  const cotaDoPlano = new Map();
  for (const p of planos) {
    const soma = p.hourQuotas.reduce((a, q) => a + (Number(q.quantity) || 0), 0);
    cotaDoPlano.set(p.planId, { nome: p.name, cota: soma, linhas: p.hourQuotas });
  }
  diz(`Planos ativos com cota de horas: **${cotaDoPlano.size}**\n`);
  if (!cotaDoPlano.size) return null;

  // ⚠ `planId[]`, COM colchete. Sem ele a API responde 400 "planId field must
  // be array" — e a primeira versao desta prova passou `planId`, engoliu o erro
  // como "0 contratos" e quase me fez concluir que o defeito estava no espelho.
  // A armadilha esta documentada no cliente; a sonda pisou nela mesmo assim.
  const rc = await paginar("contracts", {
    isActive: 1,
    "planId[]": [...cotaDoPlano.keys()],
  });
  const contratos = rc.todos.filter((c) => c.isActive && cotaDoPlano.has(c.planId));
  diz(`Contratos ativos nesses planos: **${contratos.length}**`);

  // Concessao por cliente: a cota do plano, sobrescrita pelo contrato quando ele
  // declara a sua propria (`hourPlanQuota`).
  const porCliente = new Map();
  for (const c of contratos) {
    if (c.customerId == null) continue;
    const doPlano = cotaDoPlano.get(c.planId);
    const hq = Array.isArray(c.hourPlanQuota) ? c.hourPlanQuota : [];
    const doContrato = hq.length ? hq.reduce((a, q) => a + (Number(q.quantity) || 0), 0) : null;
    const atual = porCliente.get(c.customerId) ?? { concedido: 0, contratos: [] };
    atual.concedido += doContrato ?? doPlano.cota;
    atual.contratos.push({
      contractId: c.contractId,
      plano: doPlano.nome,
      cotaPlano: doPlano.cota,
      cotaContrato: doContrato,
      linhasPlano: doPlano.linhas,
      linhasContrato: hq,
      productQuotas: c.productQuotas,
      startDate: c.startDate,
    });
    porCliente.set(c.customerId, atual);
  }
  diz(`Clientes com concessao conhecida: **${porCliente.size}**\n`);

  // Consumo: reservas abatidas da cota nos ultimos 60 dias, em lote por cliente.
  const ids = [...porCliente.keys()];
  const desde = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
  const LOTE = 40;
  const abatidoPor = new Map();
  for (let i = 0; i < ids.length; i += LOTE) {
    const fatia = ids.slice(i, i + LOTE);
    const rb = await paginar("room/bookings", {
      "customerId[]": fatia,
      createdAtFrom: `${desde}T00:00:00-03:00`,
    });
    if (!rb.ok) {
      diz(`> falha ao ler reservas do lote ${i / LOTE}: status ${rb.status}`);
      break;
    }
    for (const b of rb.todos) {
      if (!b.isActive || b.cancellationReason) continue;
      if (b.status !== "deductedFromQuota") continue;
      const h = horasDe(b);
      if (h === null) continue;
      abatidoPor.set(b.customerId, (abatidoPor.get(b.customerId) ?? 0) + h);
    }
  }
  diz(`Clientes com horas abatidas nos ultimos 60 dias: **${abatidoPor.size}**\n`);

  const impossiveis = [];
  for (const [id, v] of porCliente) {
    const ab = abatidoPor.get(id) ?? 0;
    if (ab > v.concedido + 0.01) impossiveis.push({ id, abatido: ab, ...v });
  }
  impossiveis.sort((a, b) => b.abatido - b.concedido - (a.abatido - a.concedido));

  if (!impossiveis.length) {
    diz(
      "**Nenhum caso impossivel pela API.** Se o espelho ainda mostra, o defeito e de CARGA\n" +
        "(dado velho), nao de regra — e a Prova 1 explica por que.",
    );
    return { impossiveis: [] };
  }

  diz(`### ⚠ ${impossiveis.length} cliente(s) com \`abatido > concedido\` na propria API\n`);
  for (const c of impossiveis.slice(0, 8)) {
    diz(
      `- **cliente #${c.id}** — abatido **${c.abatido.toFixed(1)}h** vs. concedido **${c.concedido}h** (falta ${(c.abatido - c.concedido).toFixed(1)}h)`,
    );
    for (const ct of c.contratos) {
      diz(
        `  - contrato \`#${ct.contractId}\` · plano **${ct.plano}** · cota do plano ${ct.cotaPlano}h · cota do contrato ${ct.cotaContrato ?? "(ausente)"}`,
      );
      if (Array.isArray(ct.productQuotas) && ct.productQuotas.length)
        diz(`    - \`productQuotas\`: \`${JSON.stringify(ct.productQuotas)}\``);
      if (ct.linhasContrato.length)
        diz(`    - \`hourPlanQuota\`: \`${JSON.stringify(ct.linhasContrato)}\``);
    }
  }
  return { impossiveis, ids: impossiveis.map((c) => c.id) };
}

/** Horas de uma reserva, pelo par startTime/finalTime. */
function horasDe(b) {
  if (!b.startTime || !b.finalTime) return null;
  const a = Date.parse(b.startTime);
  const z = Date.parse(b.finalTime);
  if (!Number.isFinite(a) || !Number.isFinite(z) || z <= a) return null;
  return (z - a) / 3_600_000;
}

// ---------------------------------------------------------------------------
// PROVA 3 — pacotes
// ---------------------------------------------------------------------------
async function prova3(idsSuspeitos) {
  diz("\n## Prova 3 — `recurringSales` e os pacotes inalcancaveis\n");
  const r = await paginar("recurringSales", { isActive: 1 });
  if (!r.ok) {
    diz(`> status ${r.status}`);
    return;
  }
  const ativas = r.todos;
  const comPacote = ativas.filter((x) => x.packageId != null);
  const comProduto = ativas.filter((x) => x.productId != null);
  const pacotes = [...new Set(comPacote.map((x) => x.packageId))];
  diz(`- Assinaturas ativas: **${ativas.length}**`);
  diz(`- Com \`packageId\`: **${comPacote.length}** (${pacotes.length} pacotes distintos)`);
  diz(`- Com \`productId\`: **${comProduto.length}**`);

  // `/packages` deu 404 na prova de cobertura. Confirmando com um id real.
  if (pacotes.length) {
    const alvo = pacotes[0];
    for (const rota of [`packages`, `package/${alvo}`, `hourPackages`]) {
      const t = await pedir(rota, { limit: 1 });
      diz(`- \`GET /${rota}\` → **${t.status}**`);
    }
    diz(
      `\n> Se todas responderam 404, o conteudo do pacote (quantas horas ele concede) e\n> **inalcancavel por este token**. Isso e um pedido ao admin do Conexa, nao codigo.`,
    );
  }

  if (idsSuspeitos && idsSuspeitos.length) {
    diz(`\n### Os clientes impossiveis tem assinatura recorrente?\n`);
    const set = new Set(idsSuspeitos);
    const deles = ativas.filter((x) => set.has(x.customerId));
    if (!deles.length) {
      diz(
        "**Nenhum deles tem assinatura recorrente ativa.** Entao a hora extra NAO vem de pacote\n" +
          "recorrente — mais uma hipotese morta, e a boa noticia e que `recurringSales` deixa de\n" +
          "ser bloqueio para o saldo (segue valendo para as regras 2 e 9).",
      );
    } else {
      for (const x of deles)
        diz(
          `- cliente **#${x.customerId}** → \`recurringSaleId ${x.recurringSaleId}\`, packageId ${x.packageId ?? "—"}, productId ${x.productId ?? "—"}, qty ${x.quantity}, ${x.frequency}`,
        );
    }
  }
}

// ---------------------------------------------------------------------------
(async () => {
  diz("# Prova de consistencia — API Conexa v2");
  diz(`\nBase: \`${BASE_URL}\` · ritmo ${REQ_POR_MIN} req/min · disjuntor ${MAX_REQ}\n`);
  const t0 = Date.now();
  try {
    await prova1();
    const p2 = await prova2();
    await prova3(p2 && p2.ids);
  } catch (e) {
    diz(`\n> **INTERROMPIDO:** ${e.message}`);
  }
  diz(
    `\n---\n\nRequisicoes: **${feitas}** · duracao **${((Date.now() - t0) / 1000).toFixed(0)}s**`,
  );
  const saida = resolve(RAIZ, "docs/context/prova-consistencia-resultado.md");
  mkdirSync(dirname(saida), { recursive: true });
  writeFileSync(saida, rel.join("\n") + "\n", "utf8");
  console.log(`\n→ ${saida}`);
})();
