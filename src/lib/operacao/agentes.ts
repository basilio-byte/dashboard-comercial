import "server-only";
import { prisma } from "@/lib/db";
import { registrarMudanca, type Origem } from "@/lib/regras/config";

/**
 * CADASTRO DE AGENTES — quem usa a ferramenta.
 *
 * Pedido do Diego em 2026-09-16: *"campo para cadastro de agentes (Diego,
 * Guilherme...)"*.
 *
 * ⚠ **Não confundir com o vendedor responsável do Conexa.** Aquele não é
 * resolvível: `/sellers` responde 404 por permissão, e mesmo liberado o
 * `sellerId` gravado no contrato é o vendedor da ÉPOCA da venda, não o de hoje.
 * Este cadastro é dos nossos — quem trabalha a fila dentro do painel — e é
 * exatamente o que `Contato.quem` vinha guardando como texto digitado.
 *
 * ⚠ O texto livre CONTINUA existindo, e isso é deliberado. Os contatos
 * registrados antes deste cadastro só têm o nome digitado; convertê-los em
 * referência exigiria adivinhar a quem cada grafia se refere ("Diego", "diego
 * s.", "DS"). Então `quem` segue sendo a verdade exibível e `agenteId` é o
 * vínculo quando ele existe.
 */

export interface AgenteResumo {
  id: string;
  nome: string;
  email: string | null;
  apelido: string | null;
  ativo: boolean;
  clickupUserId: string | null;
  chatwootAgentId: string | null;
  observacao: string | null;
  /** Quantos contatos este agente registrou. Um cadastro sem uso é visível. */
  contatos: number;
  ultimoContatoEm: Date | null;
  criadoEm: Date;
}

export async function listarAgentes(opcoes?: { incluirInativos?: boolean }): Promise<AgenteResumo[]> {
  const agentes = await prisma.agente.findMany({
    where: opcoes?.incluirInativos ? undefined : { ativo: true },
    orderBy: [{ ativo: "desc" }, { nome: "asc" }],
    include: {
      _count: { select: { contatos: true } },
      contatos: { orderBy: { contatoEm: "desc" }, take: 1, select: { contatoEm: true } },
    },
  });

  return agentes.map((a) => ({
    id: a.id,
    nome: a.nome,
    email: a.email,
    apelido: a.apelido,
    ativo: a.ativo,
    clickupUserId: a.clickupUserId,
    chatwootAgentId: a.chatwootAgentId,
    observacao: a.observacao,
    contatos: a._count.contatos,
    ultimoContatoEm: a.contatos[0]?.contatoEm ?? null,
    criadoEm: a.criadoEm,
  }));
}

export interface DadosDeAgente {
  nome: string;
  email?: string | null;
  apelido?: string | null;
  ativo?: boolean;
  clickupUserId?: string | null;
  chatwootAgentId?: string | null;
  observacao?: string | null;
}

const vazioParaNulo = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  return t.length ? t : null;
};

export async function criarAgente(
  dados: DadosDeAgente,
  ctx: { quem: string | null; origem: Origem },
): Promise<AgenteResumo> {
  const nome = dados.nome.trim();
  if (!nome) throw new Error("Informe o nome do agente.");

  const email = vazioParaNulo(dados.email);
  if (email && (await prisma.agente.findUnique({ where: { email } }))) {
    throw new Error(`Já existe agente com o e-mail ${email}.`);
  }

  const a = await prisma.agente.create({
    data: {
      nome,
      email,
      apelido: vazioParaNulo(dados.apelido),
      ativo: dados.ativo ?? true,
      clickupUserId: vazioParaNulo(dados.clickupUserId),
      chatwootAgentId: vazioParaNulo(dados.chatwootAgentId),
      observacao: vazioParaNulo(dados.observacao),
      criadoPor: ctx.quem,
    },
  });

  await registrarMudanca({
    entidade: "agente",
    chave: a.id,
    acao: "criou",
    depois: { nome: a.nome, email: a.email, ativo: a.ativo },
    quem: ctx.quem,
    origem: ctx.origem,
  });

  return (await listarAgentes({ incluirInativos: true })).find((x) => x.id === a.id)!;
}

export async function atualizarAgente(
  id: string,
  dados: Partial<DadosDeAgente>,
  ctx: { quem: string | null; origem: Origem },
): Promise<AgenteResumo> {
  const antes = await prisma.agente.findUnique({ where: { id } });
  if (!antes) throw new Error("Agente não encontrado.");

  const email = dados.email === undefined ? antes.email : vazioParaNulo(dados.email);
  if (email && email !== antes.email) {
    const colide = await prisma.agente.findUnique({ where: { email } });
    if (colide) throw new Error(`Já existe agente com o e-mail ${email}.`);
  }

  const depois = await prisma.agente.update({
    where: { id },
    data: {
      nome: dados.nome === undefined ? antes.nome : dados.nome.trim() || antes.nome,
      email,
      apelido: dados.apelido === undefined ? antes.apelido : vazioParaNulo(dados.apelido),
      ativo: dados.ativo ?? antes.ativo,
      clickupUserId:
        dados.clickupUserId === undefined ? antes.clickupUserId : vazioParaNulo(dados.clickupUserId),
      chatwootAgentId:
        dados.chatwootAgentId === undefined
          ? antes.chatwootAgentId
          : vazioParaNulo(dados.chatwootAgentId),
      observacao: dados.observacao === undefined ? antes.observacao : vazioParaNulo(dados.observacao),
    },
  });

  await registrarMudanca({
    entidade: "agente",
    chave: id,
    acao: "alterou",
    antes: { nome: antes.nome, email: antes.email, ativo: antes.ativo },
    depois: { nome: depois.nome, email: depois.email, ativo: depois.ativo },
    quem: ctx.quem,
    origem: ctx.origem,
  });

  return (await listarAgentes({ incluirInativos: true })).find((x) => x.id === id)!;
}

/**
 * Desativa o agente. **Não apaga.**
 *
 * ⚠ Apagar o agente romperia o vínculo dos contatos que ele registrou —
 * `onDelete: SetNull` deixaria o `quem` em texto e o `agenteId` nulo, o que é
 * recuperável, mas perderia o roster do disparo (clickupUserId) sem aviso. E
 * quem sai da empresa continua tendo registrado os contatos que registrou:
 * histórico comercial não se apaga porque alguém mudou de emprego.
 */
export async function desativarAgente(
  id: string,
  ctx: { quem: string | null; origem: Origem },
): Promise<AgenteResumo> {
  return atualizarAgente(id, { ativo: false }, ctx);
}

/**
 * Remove de verdade — só quando nunca registrou contato.
 *
 * Existe para o caso banal do cadastro digitado errado, que desativar não
 * resolve (fica sujeira na lista para sempre).
 */
export async function removerAgente(
  id: string,
  ctx: { quem: string | null; origem: Origem },
): Promise<void> {
  const a = await prisma.agente.findUnique({
    where: { id },
    include: { _count: { select: { contatos: true } } },
  });
  if (!a) throw new Error("Agente não encontrado.");
  if (a._count.contatos > 0) {
    throw new Error(
      `${a.nome} tem ${a._count.contatos} contato(s) registrado(s) — desative em vez de remover, ` +
        "para o histórico não perder de quem foi o contato.",
    );
  }

  await prisma.agente.delete({ where: { id } });
  await registrarMudanca({
    entidade: "agente",
    chave: id,
    acao: "removeu",
    antes: { nome: a.nome, email: a.email },
    quem: ctx.quem,
    origem: ctx.origem,
  });
}
