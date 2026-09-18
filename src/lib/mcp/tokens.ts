import "server-only";
import type { EscopoToken } from "@prisma/client";
import { prisma } from "@/lib/db";
import { registrarMudanca } from "@/lib/regras/config";
import { gerarToken, hashDoToken, pareceTokenPessoal, prefixoVisivel } from "./token-formato";

/**
 * TOKENS PESSOAIS DO MCP — criar, listar, revogar, autenticar.
 *
 * ⚠ Nenhuma ferramenta do MCP cria token. A gestão é só pela tela, com sessão
 * de login. Se um token vazasse e pudesse emitir outros, revogá-lo não
 * adiantaria — o invasor já teria feito cópias com nomes inocentes.
 */

export interface TokenListado {
  id: string;
  nome: string;
  prefixo: string;
  escopo: EscopoToken;
  criadoEm: Date;
  ultimoUsoEm: Date | null;
  revogadoEm: Date | null;
  revogadoPor: string | null;
  dono: { id: string; nome: string; email: string };
}

export async function criarTokenMcp(p: {
  userId: string;
  nome: string;
  escopo: EscopoToken;
  quem: string;
}): Promise<{ token: string; registro: TokenListado }> {
  const nome = p.nome.trim();
  if (!nome) throw new Error("Dê um nome ao token — é o que permite reconhecê-lo depois.");
  if (nome.length > 60) throw new Error("Nome longo demais (máximo 60 caracteres).");

  const usuario = await prisma.user.findUnique({ where: { id: p.userId } });
  if (!usuario || !usuario.isActive) throw new Error("Usuário inexistente ou inativo.");
  // Perfil somente leitura não emite token que escreve — o token não pode ter
  // mais poder que a pessoa.
  const escopo: EscopoToken = usuario.role === "VIEWER" ? "LEITURA" : p.escopo;

  const token = gerarToken();
  const criado = await prisma.tokenMcp.create({
    data: {
      userId: p.userId,
      nome,
      prefixo: prefixoVisivel(token),
      hash: hashDoToken(token),
      escopo,
    },
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  await registrarMudanca({
    entidade: "token_mcp",
    chave: criado.id,
    acao: "criou",
    // ⚠ Só o prefixo. O token jamais entra no rastro.
    depois: { nome, prefixo: criado.prefixo, escopo, dono: usuario.email },
    quem: p.quem,
    origem: "UI",
  });

  return { token, registro: paraListado(criado) };
}

export async function listarTokensMcp(filtro: { userId?: string }): Promise<TokenListado[]> {
  const linhas = await prisma.tokenMcp.findMany({
    where: filtro.userId ? { userId: filtro.userId } : undefined,
    orderBy: [{ revogadoEm: { sort: "asc", nulls: "first" } }, { criadoEm: "desc" }],
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  return linhas.map(paraListado);
}

/**
 * Revoga. **Não apaga**: o rastro de mudanças aponta para o token, e "quem fez
 * isto?" precisa continuar tendo resposta depois da revogação.
 */
export async function revogarTokenMcp(p: {
  id: string;
  quem: string;
  /** O dono pode revogar os dele; ADMIN pode revogar qualquer um. */
  userId: string;
  ehAdmin: boolean;
}): Promise<void> {
  const t = await prisma.tokenMcp.findUnique({ where: { id: p.id } });
  if (!t) throw new Error("Token não encontrado.");
  if (t.userId !== p.userId && !p.ehAdmin) throw new Error("Só o dono ou um administrador revoga este token.");
  if (t.revogadoEm) return;

  await prisma.tokenMcp.update({
    where: { id: p.id },
    data: { revogadoEm: new Date(), revogadoPor: p.quem },
  });
  await registrarMudanca({
    entidade: "token_mcp",
    chave: p.id,
    acao: "removeu",
    antes: { nome: t.nome, prefixo: t.prefixo, escopo: t.escopo },
    quem: p.quem,
    origem: "UI",
  });
}

export interface IdentidadeMcp {
  tokenId: string;
  nomeDoToken: string;
  email: string;
  /** O escopo EFETIVO — o menor entre o do token e o da pessoa. */
  escopo: EscopoToken;
}

/** Não regrava o "último uso" a cada chamada: um MCP conversando faz dezenas. */
const INTERVALO_DE_USO_MS = 60_000;

/**
 * Autentica um token pessoal. `null` = não autentica, sem dizer por quê.
 *
 * ⚠ Confere a PESSOA a cada chamada, não só o token. Desativar um usuário
 * precisa derrubar os tokens dele na hora — a mesma regra das sessões de login.
 * E o papel também: quem virou VIEWER perde a escrita pelo MCP no mesmo
 * instante, mesmo com um token criado como ESCRITA.
 */
export async function autenticarTokenMcp(valor: string): Promise<IdentidadeMcp | null> {
  if (!pareceTokenPessoal(valor)) return null;

  const t = await prisma.tokenMcp.findUnique({
    where: { hash: hashDoToken(valor) },
    include: { user: { select: { email: true, isActive: true, role: true } } },
  });
  if (!t || t.revogadoEm || !t.user.isActive) return null;

  if (!t.ultimoUsoEm || Date.now() - t.ultimoUsoEm.getTime() > INTERVALO_DE_USO_MS) {
    // Sem await: marcar o uso não pode atrasar nem derrubar a chamada.
    prisma.tokenMcp
      .update({ where: { id: t.id }, data: { ultimoUsoEm: new Date() } })
      .catch((err) => console.error("[mcp] falhou ao registrar uso do token:", err));
  }

  return {
    tokenId: t.id,
    nomeDoToken: t.nome,
    email: t.user.email,
    escopo: t.user.role === "VIEWER" ? "LEITURA" : t.escopo,
  };
}

/** Existe algum token pessoal ativo? Usado para a rota saber se está "fechada". */
export async function existeTokenPessoalAtivo(): Promise<boolean> {
  return (await prisma.tokenMcp.count({ where: { revogadoEm: null } })) > 0;
}

function paraListado(t: {
  id: string;
  nome: string;
  prefixo: string;
  escopo: EscopoToken;
  criadoEm: Date;
  ultimoUsoEm: Date | null;
  revogadoEm: Date | null;
  revogadoPor: string | null;
  user: { id: string; name: string; email: string };
}): TokenListado {
  return {
    id: t.id,
    nome: t.nome,
    prefixo: t.prefixo,
    escopo: t.escopo,
    criadoEm: t.criadoEm,
    ultimoUsoEm: t.ultimoUsoEm,
    revogadoEm: t.revogadoEm,
    revogadoPor: t.revogadoPor,
    dono: { id: t.user.id, nome: t.user.name, email: t.user.email },
  };
}
