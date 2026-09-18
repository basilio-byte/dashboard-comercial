import "server-only";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import {
  CODIGOS_NATIVOS,
  FAMILIAS,
  NATIVOS,
  lerParams,
  novoCodigo,
  paramsPorFamilia,
  type Familia,
} from "./catalogo";

/**
 * A CONFIGURAÇÃO VIVA DOS GATILHOS — o que está ligado, e com quais limiares.
 *
 * ⚠ **Um banco vazio se comporta exatamente como o de ontem.** Os nativos que
 * não têm linha em `gatilhos` usam os defaults do catálogo, que são os mesmos
 * valores que viviam como constante em `avaliar.ts`. Só existe linha no banco
 * para o que alguém editou — e é isso que torna a mudança segura de publicar:
 * não há passo de migração de dado, nem tela que precise ser aberta antes de o
 * motor voltar a funcionar.
 *
 * ⚠ **Não há escrita no caminho de leitura.** Foi uma tentação: bastaria semear
 * as 12 linhas na primeira consulta e a tela teria o que editar. Mas isso faz
 * uma página de consulta escrever no banco de produção, e depois ninguém sabe
 * se a linha veio de alguém ou do sistema. Quem cria linha é quem edita.
 */

export interface GatilhoResolvido {
  codigo: string;
  nome: string;
  familia: Familia;
  oferta: string;
  condicao: string;
  ativo: boolean;
  /** Já validado e completado com os defaults da família. */
  params: Record<string, unknown>;
  peso: number;
  ordem: number;
  nativo: boolean;
  nota: string;
  /**
   * Por que não é avaliável hoje — estado do mundo, não configuração. Ligar um
   * gatilho bloqueado não o faz disparar; a tela precisa dizer isso.
   */
  bloqueio: string | null;
  /** PADRAO = nunca foi editado. BANCO = alguém mexeu. */
  origemDaConfig: "PADRAO" | "BANCO";
  /** Params do banco ilegíveis: caiu no default e a tela precisa gritar. */
  problemaNosParams: string | null;
  atualizadoEm: Date | null;
  atualizadoPor: string | null;
}

export interface Gatilhos {
  todos: GatilhoResolvido[];
  porCodigo: Map<string, GatilhoResolvido>;
  /** Está ligado E não está bloqueado — as duas condições para avaliar. */
  avalia(codigo: string): boolean;
  /** Params de um gatilho, com o tipo da família. */
  params<F extends Familia>(codigo: string, familia: F): ReturnType<typeof lerParams<F>>["params"];
  /** Quantos foram editados — a tela diz se a config está "de fábrica". */
  editados: number;
}

function resolver(
  nativo: (typeof NATIVOS)[number] | null,
  linha: Prisma.GatilhoGetPayload<object> | null,
): GatilhoResolvido {
  const familia = (linha?.familia ?? nativo?.familia) as Familia;
  const brutos = linha ? linha.params : nativo?.params;
  const { params, problema } = lerParams(familia, brutos);

  return {
    codigo: (linha?.codigo ?? nativo!.codigo) as string,
    nome: linha?.nome ?? nativo!.nome,
    familia,
    oferta: linha?.oferta ?? nativo!.oferta,
    condicao: linha?.condicao ?? nativo?.condicao ?? "",
    ativo: linha?.ativo ?? true,
    params: params as Record<string, unknown>,
    peso: linha?.peso ?? nativo?.peso ?? 50,
    ordem: linha?.ordem ?? nativo?.ordem ?? 99,
    nativo: linha ? linha.nativo : true,
    // `||` e não `??`: nota vazia no banco devolve a do catálogo. Ver a nota
    // sobre congelamento em `salvarGatilho`.
    nota: linha?.nota || nativo?.nota || "",
    // ⚠ O bloqueio vem SEMPRE do catálogo, nunca do banco: é fato medido
    // contra a API (o 404 de `/packages`), e deixar alguém "destravar" a regra
    // 2 pela tela seria oferecer um botão que não faz nada.
    bloqueio: nativo?.bloqueio ?? null,
    origemDaConfig: linha ? "BANCO" : "PADRAO",
    problemaNosParams: problema,
    atualizadoEm: linha?.atualizadoEm ?? null,
    atualizadoPor: linha?.atualizadoPor ?? null,
  };
}

export async function carregarGatilhos(): Promise<Gatilhos> {
  const linhas = await prisma.gatilho.findMany();
  const porLinha = new Map(linhas.map((l) => [l.codigo, l]));

  const todos: GatilhoResolvido[] = [
    ...NATIVOS.map((n) => resolver(n, porLinha.get(n.codigo) ?? null)),
    // Os criados aqui dentro: linhas sem nativo correspondente.
    ...linhas.filter((l) => !CODIGOS_NATIVOS.has(l.codigo)).map((l) => resolver(null, l)),
  ].sort((a, b) => a.ordem - b.ordem || a.codigo.localeCompare(b.codigo));

  const porCodigo = new Map(todos.map((g) => [g.codigo, g]));

  return {
    todos,
    porCodigo,
    avalia: (codigo) => {
      const g = porCodigo.get(codigo);
      return !!g && g.ativo && g.bloqueio === null;
    },
    params: (codigo, familia) => {
      const g = porCodigo.get(codigo);
      return lerParams(familia, g?.params).params;
    },
    editados: linhas.length,
  };
}

// ---------------------------------------------------------------------------
// Escrita — sempre com rastro
// ---------------------------------------------------------------------------

export type Origem = "UI" | "MCP" | "SISTEMA";

/**
 * ⚠ A gravação do rastro NÃO derruba a operação.
 *
 * É a mesma escolha de `acaoReconciliar`: o efeito é o produto, o histórico é o
 * bônus. Um índice corrompido na tabela de auditoria não pode impedir alguém de
 * desligar às pressas um gatilho que está disparando errado.
 */
export async function registrarMudanca(m: {
  entidade: string;
  chave: string;
  acao: "criou" | "alterou" | "removeu";
  antes?: unknown;
  depois?: unknown;
  quem: string | null;
  origem: Origem;
}): Promise<void> {
  try {
    await prisma.mudancaDeConfig.create({
      data: {
        entidade: m.entidade,
        chave: m.chave,
        acao: m.acao,
        antes: (m.antes ?? undefined) as Prisma.InputJsonValue | undefined,
        depois: (m.depois ?? undefined) as Prisma.InputJsonValue | undefined,
        quem: m.quem,
        origem: m.origem,
      },
    });
  } catch (err) {
    console.error("[config] falhou ao registrar a mudança:", err);
  }
}

export interface EdicaoDeGatilho {
  nome?: string;
  oferta?: string;
  condicao?: string | null;
  ativo?: boolean;
  params?: Record<string, unknown>;
  peso?: number;
  ordem?: number;
  nota?: string | null;
}

/**
 * Salva a edição de um gatilho — nativo ou criado aqui.
 *
 * ⚠ A FAMÍLIA de um nativo não é editável. Trocá-la mudaria o significado de um
 * código que já está gravado em `Contato.regra`: o histórico passaria a dizer
 * que o vendedor ligou para o cliente por causa de uma pergunta que a regra
 * nunca fez.
 */
export async function salvarGatilho(
  codigo: string,
  edicao: EdicaoDeGatilho,
  ctx: { quem: string | null; origem: Origem },
): Promise<GatilhoResolvido> {
  const atuais = await carregarGatilhos();
  const antes = atuais.porCodigo.get(codigo);
  if (!antes) throw new Error(`Gatilho desconhecido: ${codigo}`);

  if (edicao.params !== undefined) {
    const r = paramsPorFamilia[antes.familia].safeParse(edicao.params);
    if (!r.success) {
      throw new Error(
        `Parâmetros inválidos para a família ${antes.familia}: ` +
          r.error.issues.map((i) => `${i.path.join(".") || "params"} ${i.message}`).join("; "),
      );
    }
    edicao = { ...edicao, params: r.data as Record<string, unknown> };
  }

  /**
   * ⚠ A NOTA só é gravada quando alguém a edita.
   *
   * A versão anterior copiava `antes.nota` — a nota resolvida, que para um
   * nativo nunca editado É a do catálogo — para a linha nova. Desligar um
   * gatilho congelava a documentação daquele dia no banco. Achado em 2026-09-18:
   * as regras 3, 4 e métrica foram desligadas horas antes de as notas delas
   * ganharem a explicação da correção, e a tela continuaria mostrando a antiga.
   */
  const linhaAntes = await prisma.gatilho.findUnique({ where: { codigo }, select: { nota: true } });

  const dados = {
    nome: edicao.nome ?? antes.nome,
    familia: antes.familia,
    oferta: edicao.oferta ?? antes.oferta,
    condicao: edicao.condicao === undefined ? antes.condicao : edicao.condicao,
    ativo: edicao.ativo ?? antes.ativo,
    params: (edicao.params ?? antes.params) as Prisma.InputJsonValue,
    peso: edicao.peso ?? antes.peso,
    ordem: edicao.ordem ?? antes.ordem,
    nota:
      edicao.nota !== undefined
        ? edicao.nota
        : antes.nativo
          ? (linhaAntes?.nota ?? null)
          : antes.nota,
    nativo: antes.nativo,
    atualizadoPor: ctx.quem,
  };

  // Upsert porque o nativo pode nunca ter tido linha: a primeira edição é que a
  // cria. Ver a nota sobre não escrever no caminho de leitura.
  await prisma.gatilho.upsert({
    where: { codigo },
    create: { codigo, ...dados },
    update: dados,
  });

  await registrarMudanca({
    entidade: "gatilho",
    chave: codigo,
    acao: "alterou",
    antes: resumo(antes),
    depois: { ...resumo(antes), ...dados, params: dados.params },
    quem: ctx.quem,
    origem: ctx.origem,
  });

  const depois = await carregarGatilhos();
  return depois.porCodigo.get(codigo)!;
}

export interface NovoGatilho {
  nome: string;
  familia: Familia;
  oferta: string;
  condicao?: string;
  params?: Record<string, unknown>;
  peso?: number;
  ativo?: boolean;
  nota?: string;
  /** Opcional: permite um código legível. Nunca colide com nativo. */
  codigo?: string;
}

export async function criarGatilho(
  novo: NovoGatilho,
  ctx: { quem: string | null; origem: Origem },
): Promise<GatilhoResolvido> {
  if (!FAMILIAS.includes(novo.familia)) {
    throw new Error(
      `Família desconhecida: ${novo.familia}. As que o código sabe avaliar são ${FAMILIAS.join(", ")}. ` +
        "Uma pergunta que nenhuma delas faz precisa de função pura nova, com teste — não de linha de tabela.",
    );
  }
  const codigo = novo.codigo?.trim() || novoCodigo();
  if (CODIGOS_NATIVOS.has(codigo)) {
    throw new Error(`"${codigo}" é código de gatilho nativo — escolha outro.`);
  }
  if (await prisma.gatilho.findUnique({ where: { codigo } })) {
    throw new Error(`Já existe gatilho com o código "${codigo}".`);
  }

  const r = paramsPorFamilia[novo.familia].safeParse(novo.params ?? {});
  if (!r.success) {
    throw new Error(
      `Parâmetros inválidos para ${novo.familia}: ` +
        r.error.issues.map((i) => `${i.path.join(".") || "params"} ${i.message}`).join("; "),
    );
  }

  const maiorOrdem = await prisma.gatilho.aggregate({ _max: { ordem: true } });
  const criado = await prisma.gatilho.create({
    data: {
      codigo,
      nome: novo.nome,
      familia: novo.familia,
      oferta: novo.oferta,
      condicao: novo.condicao ?? null,
      ativo: novo.ativo ?? true,
      params: r.data as Prisma.InputJsonValue,
      peso: novo.peso ?? 50,
      ordem: Math.max(maiorOrdem._max.ordem ?? 0, 99) + 1,
      nativo: false,
      nota: novo.nota ?? null,
      atualizadoPor: ctx.quem,
    },
  });

  await registrarMudanca({
    entidade: "gatilho",
    chave: codigo,
    acao: "criou",
    depois: { nome: criado.nome, familia: criado.familia, params: criado.params },
    quem: ctx.quem,
    origem: ctx.origem,
  });

  return resolver(null, criado);
}

/**
 * Remove um gatilho criado aqui dentro.
 *
 * ⚠ Nativo não se remove, se desliga. Apagar o código "8" deixaria todo
 * `Contato` que registra "liguei por causa da regra 8" apontando para uma
 * pergunta que não existe mais — e o histórico de contato é justamente o que
 * impede a fila de reofertar. Perder o significado dele custa mais que a
 * arrumação de tirar uma linha da lista.
 */
export async function removerGatilho(
  codigo: string,
  ctx: { quem: string | null; origem: Origem },
): Promise<void> {
  if (CODIGOS_NATIVOS.has(codigo)) {
    throw new Error(
      `"${codigo}" é gatilho nativo e não pode ser removido — desligue-o em vez disso. ` +
        "Remover o código órfã os contatos que registram tê-lo usado.",
    );
  }
  const linha = await prisma.gatilho.findUnique({ where: { codigo } });
  if (!linha) throw new Error(`Gatilho desconhecido: ${codigo}`);

  await prisma.gatilho.delete({ where: { codigo } });
  await registrarMudanca({
    entidade: "gatilho",
    chave: codigo,
    acao: "removeu",
    antes: { nome: linha.nome, familia: linha.familia, params: linha.params },
    quem: ctx.quem,
    origem: ctx.origem,
  });
}

/** Devolve o nativo ao padrão de fábrica: apaga a linha de edição. */
export async function restaurarGatilho(
  codigo: string,
  ctx: { quem: string | null; origem: Origem },
): Promise<GatilhoResolvido> {
  if (!CODIGOS_NATIVOS.has(codigo)) {
    throw new Error(`"${codigo}" não é nativo — não há padrão de fábrica para restaurar.`);
  }
  const linha = await prisma.gatilho.findUnique({ where: { codigo } });
  if (linha) {
    await prisma.gatilho.delete({ where: { codigo } });
    await registrarMudanca({
      entidade: "gatilho",
      chave: codigo,
      acao: "alterou",
      antes: { nome: linha.nome, params: linha.params, ativo: linha.ativo },
      depois: { restaurado: "padrão do catálogo" },
      quem: ctx.quem,
      origem: ctx.origem,
    });
  }
  const g = await carregarGatilhos();
  return g.porCodigo.get(codigo)!;
}

function resumo(g: GatilhoResolvido) {
  return { nome: g.nome, oferta: g.oferta, ativo: g.ativo, params: g.params, peso: g.peso };
}
