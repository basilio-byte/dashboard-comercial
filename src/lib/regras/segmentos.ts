import "server-only";
import { prisma } from "@/lib/db";
import type { SegmentoCategoria } from "@prisma/client";
import { ehSegmentoFiscal, ehSegmentoPrivativa, ehSegmentoSeaBox } from "./familias";
import { registrarMudanca, type Origem } from "./config";

/**
 * COMO UMA CATEGORIA DE SERVIÇO É LIDA — manual primeiro, nome depois.
 *
 * Pedido do Diego em 2026-09-16: *"classificar categorias"*, citando "Meu
 * Depósito" e as três "Serviços de Espaço".
 *
 * ⚠ O pedido conserta um defeito que já estava marcado como risco no próprio
 * repositório. O casamento por trecho de nome — "privativ", "fiscal", "seabox"
 * — **silencia sem avisar**: renomear a categoria no Conexa faz as regras 1, 6,
 * 7, 8 e 10 pararem de encontrar contrato, a fila encolher, e não há erro em
 * lugar nenhum. O id não muda quando o nome muda; a classificação manual é por
 * id.
 *
 * A ordem de precedência é deliberada:
 *
 *  1. **MANUAL** — alguém disse o que a categoria é. Vence sempre.
 *  2. **NOME** — a heurística de substring, que segue valendo para o que
 *     ninguém classificou. É sugestão, e a tela mostra que é.
 *  3. **NENHUM** — nem uma coisa nem outra. Não adivinha: a categoria
 *     simplesmente não aciona regra de segmento.
 *
 * ⚠ 3 não é o mesmo que `IGNORAR`. "Ninguém olhou" e "olharam e decidiram que
 * não interessa" parecem iguais na fila e são opostos na hora de auditar por
 * que um cliente não apareceu.
 */

export type OrigemDoSegmento = "MANUAL" | "NOME" | "NENHUM";

export interface LeituraDeCategoria {
  conexaId: number;
  /** Como veio do Conexa. Nunca sobrescrito — o `rotulo` é que é nosso. */
  nome: string;
  segmento: SegmentoCategoria | null;
  origem: OrigemDoSegmento;
  rotulo: string | null;
  unidade: string | null;
  nota: string | null;
  definidoPor: string | null;
  definidoEm: Date | null;
  /** Quantos planos usam esta categoria. Zero = não classifica contrato nenhum. */
  planos: number;
  /** O que a heurística de nome diria, mesmo quando o manual venceu. */
  sugestaoPeloNome: SegmentoCategoria | null;
}

export interface MapaDeSegmentos {
  /** O segmento de uma categoria, já com a precedência aplicada. */
  de(conexaId: number | null | undefined, nome: string | null | undefined): SegmentoCategoria | null;
  ehPrivativa(conexaId: number | null | undefined, nome: string | null | undefined): boolean;
  ehFiscal(conexaId: number | null | undefined, nome: string | null | undefined): boolean;
  ehSeaBox(conexaId: number | null | undefined, nome: string | null | undefined): boolean;
  /** Unidade física declarada para a categoria, quando houver. */
  unidadeDe(conexaId: number | null | undefined): string | null;
  /**
   * A categoria NÃO é de permanência: classificada à mão como PROGRAMA ou
   * IGNORAR. Contrato dela não conta para "perdeu o contrato" nem "reduziu".
   */
  foraDaPermanencia(conexaId: number | null | undefined): boolean;
  /** Quantas categorias têm classificação manual. Para a tela dizer se vale. */
  manuais: number;
}

/** O que a heurística de nome diz. Só três segmentos saem daqui — os outros são cadastro. */
export function sugerirPeloNome(nome: string | null | undefined): SegmentoCategoria | null {
  if (ehSegmentoSeaBox(nome)) return "SEABOX";
  if (ehSegmentoPrivativa(nome)) return "SALA_PRIVATIVA";
  if (ehSegmentoFiscal(nome)) return "ENDERECO_FISCAL";
  return null;
}

/**
 * Carrega o mapa uma vez e devolve consultas síncronas.
 *
 * ⚠ Em lote, de propósito: `filaDeSinais()` consulta o segmento de cada
 * contrato da base inteira. Uma ida ao banco por consulta seria N+1 sobre
 * milhares de contratos — o mesmo defeito que a fila em lote existe para
 * evitar.
 */
export async function carregarSegmentos(): Promise<MapaDeSegmentos> {
  const manuais = await prisma.categoriaClassificacao.findMany();
  const porId = new Map(manuais.map((m) => [m.serviceCategoryConexaId, m]));

  const de: MapaDeSegmentos["de"] = (conexaId, nome) => {
    if (conexaId != null) {
      const m = porId.get(conexaId);
      // `IGNORAR` é resposta: a categoria foi olhada e não aciona regra.
      if (m) return m.segmento === "IGNORAR" ? null : m.segmento;
    }
    return sugerirPeloNome(nome);
  };

  return {
    de,
    ehPrivativa: (id, nome) => de(id, nome) === "SALA_PRIVATIVA",
    ehFiscal: (id, nome) => de(id, nome) === "ENDERECO_FISCAL",
    ehSeaBox: (id, nome) => de(id, nome) === "SEABOX",
    unidadeDe: (id) => (id != null ? porId.get(id)?.unidade ?? null : null),
    foraDaPermanencia: (id) => {
      const seg = id != null ? porId.get(id)?.segmento : undefined;
      return seg === "PROGRAMA" || seg === "IGNORAR";
    },
    manuais: manuais.length,
  };
}

/**
 * A lista completa para a tela Gatilhos — com o que o nome sugeriria ao lado do
 * que alguém decidiu.
 *
 * Mostrar as duas colunas é o ponto: quando a sugestão do nome diverge do
 * manual, ou o Conexa renomeou a categoria, ou alguém classificou errado. Só
 * dá para perceber isso vendo as duas.
 */
export async function lerCategorias(): Promise<LeituraDeCategoria[]> {
  const [categorias, planos, manuais] = await Promise.all([
    prisma.serviceCategory.findMany({ orderBy: { name: "asc" } }),
    prisma.plan.groupBy({ by: ["serviceCategoryConexaId"], _count: true }),
    prisma.categoriaClassificacao.findMany(),
  ]);

  const usoPor = new Map(
    planos
      .filter((p) => p.serviceCategoryConexaId !== null)
      .map((p) => [p.serviceCategoryConexaId!, p._count]),
  );
  const manualPor = new Map(manuais.map((m) => [m.serviceCategoryConexaId, m]));

  return categorias.map((c) => {
    const nome = c.name ?? `categoria ${c.conexaId}`;
    const m = manualPor.get(c.conexaId);
    const sugestao = sugerirPeloNome(c.name);
    return {
      conexaId: c.conexaId,
      nome,
      segmento: m ? m.segmento : sugestao,
      origem: m ? "MANUAL" : sugestao ? "NOME" : "NENHUM",
      rotulo: m?.rotulo ?? null,
      unidade: m?.unidade ?? null,
      nota: m?.nota ?? null,
      definidoPor: m?.definidoPor ?? null,
      definidoEm: m?.definidoEm ?? null,
      planos: usoPor.get(c.conexaId) ?? 0,
      sugestaoPeloNome: sugestao,
    };
  });
}

export const SEGMENTOS: SegmentoCategoria[] = [
  "SALA_PRIVATIVA",
  "ENDERECO_FISCAL",
  "SEABOX",
  "DEPOSITO",
  "SERVICOS_DE_ESPACO",
  "PROGRAMA",
  "OUTRO",
  "IGNORAR",
];

export const ROTULO_SEGMENTO: Record<SegmentoCategoria, string> = {
  SALA_PRIVATIVA: "sala privativa",
  ENDERECO_FISCAL: "endereço fiscal",
  SEABOX: "SeaBox",
  DEPOSITO: "depósito",
  SERVICOS_DE_ESPACO: "serviços de espaço",
  PROGRAMA: "programa (com fim)",
  OUTRO: "outro",
  IGNORAR: "ignorar",
};

/** Quais regras cada segmento destrava — a coluna "Destrava" da tela. */
export const REGRAS_DO_SEGMENTO: Record<SegmentoCategoria, string> = {
  SALA_PRIVATIVA: "regras 6, 7 e 8",
  ENDERECO_FISCAL: "regras 1 e 10",
  SEABOX: "supressão das regras 5 e 7",
  DEPOSITO: "nenhuma regra hoje",
  SERVICOS_DE_ESPACO: "nenhuma regra hoje",
  PROGRAMA: "\"concluiu o programa\" — e sai do \"perdeu o contrato\"",
  OUTRO: "nenhuma regra hoje",
  IGNORAR: "nenhuma — fora do escopo, inclusive dos sinais de saída",
};

// ---------------------------------------------------------------------------
// Escrita — classificar é uma decisão, e decisão tem dono
// ---------------------------------------------------------------------------

export interface ClassificacaoDeCategoria {
  segmento: SegmentoCategoria;
  rotulo?: string | null;
  unidade?: string | null;
  nota?: string | null;
}

/**
 * Declara o que uma categoria é.
 *
 * ⚠ Exige que a categoria EXISTA no espelho. Classificar um id que o Conexa
 * não tem cria uma linha que nunca casa com nada — e, como o efeito de
 * classificar é invisível (nenhum número muda na tela), o erro só apareceria
 * como uma regra que não dispara, que é a falha silenciosa que esta tabela
 * existe para eliminar.
 */
export async function classificarCategoria(
  serviceCategoryConexaId: number,
  dados: ClassificacaoDeCategoria,
  ctx: { quem: string | null; origem: Origem },
): Promise<LeituraDeCategoria> {
  const cat = await prisma.serviceCategory.findUnique({
    where: { conexaId: serviceCategoryConexaId },
  });
  if (!cat) {
    throw new Error(
      `Categoria ${serviceCategoryConexaId} não existe no espelho. ` +
        "Rode a sincronização de cadastros antes de classificar.",
    );
  }

  const antes = await prisma.categoriaClassificacao.findUnique({
    where: { serviceCategoryConexaId },
  });

  const limpo = (v: string | null | undefined) => {
    const t = (v ?? "").trim();
    return t.length ? t : null;
  };
  const dadosLinha = {
    segmento: dados.segmento,
    rotulo: dados.rotulo === undefined ? antes?.rotulo ?? null : limpo(dados.rotulo),
    unidade: dados.unidade === undefined ? antes?.unidade ?? null : limpo(dados.unidade),
    nota: dados.nota === undefined ? antes?.nota ?? null : limpo(dados.nota),
    definidoPor: ctx.quem,
  };

  await prisma.categoriaClassificacao.upsert({
    where: { serviceCategoryConexaId },
    create: { serviceCategoryConexaId, ...dadosLinha },
    update: dadosLinha,
  });

  await registrarMudanca({
    entidade: "categoria",
    chave: String(serviceCategoryConexaId),
    acao: antes ? "alterou" : "criou",
    antes: antes ? { segmento: antes.segmento, unidade: antes.unidade } : undefined,
    depois: { nome: cat.name, segmento: dadosLinha.segmento, unidade: dadosLinha.unidade },
    quem: ctx.quem,
    origem: ctx.origem,
  });

  const todas = await lerCategorias();
  return todas.find((c) => c.conexaId === serviceCategoryConexaId)!;
}

/** Remove a classificação manual — a categoria volta a ser lida pelo nome. */
export async function limparClassificacao(
  serviceCategoryConexaId: number,
  ctx: { quem: string | null; origem: Origem },
): Promise<LeituraDeCategoria> {
  const antes = await prisma.categoriaClassificacao.findUnique({
    where: { serviceCategoryConexaId },
  });
  if (antes) {
    await prisma.categoriaClassificacao.delete({ where: { serviceCategoryConexaId } });
    await registrarMudanca({
      entidade: "categoria",
      chave: String(serviceCategoryConexaId),
      acao: "removeu",
      antes: { segmento: antes.segmento, unidade: antes.unidade },
      quem: ctx.quem,
      origem: ctx.origem,
    });
  }
  const todas = await lerCategorias();
  return todas.find((c) => c.conexaId === serviceCategoryConexaId)!;
}
