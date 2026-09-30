import "server-only";
import { prisma } from "@/lib/db";
import { hashSenha } from "@/lib/auth/password";
import { registrarMudanca, type Origem } from "@/lib/regras/config";
import {
  impedimento,
  normalizarEmail,
  validarNovoUsuario,
  type Papel,
} from "./usuarios-regras";

/**
 * USUÁRIOS DO PAINEL — quem consegue ENTRAR.
 *
 * ⚠ **Não confundir com Agentes.** Agente é quem aparece no campo "quem falou
 * com o cliente"; usuário é quem tem login. A mesma pessoa costuma ser os dois,
 * e são tabelas diferentes de propósito: contato registrado precisa sobreviver
 * à saída da pessoa, e login precisa ser revogável no mesmo minuto.
 *
 * ⚠ **Nenhuma ferramenta do MCP cria, promove ou reativa usuário** — a mesma
 * postura dos tokens pessoais. Um agente com token de escrita poderia, de
 * outra forma, criar um administrador para si.
 *
 * As travas de "não trancar todo mundo fora" vivem em `usuarios-regras.ts`,
 * puras e testadas.
 */

export interface UsuarioListado {
  id: string;
  nome: string;
  email: string;
  papel: Papel;
  ativo: boolean;
  criadoEm: Date;
  ultimoLoginEm: Date | null;
  /** Sessões ainda válidas — é o que responde "está logado agora?". */
  sessoesAtivas: number;
  /** Tokens de MCP não revogados. */
  tokensAtivos: number;
  /** Tentativas de login falhas nos últimos 7 dias, para explicar "não consigo entrar". */
  falhas7d: number;
}

export async function listarUsuarios(): Promise<UsuarioListado[]> {
  const agora = new Date();
  const seteDias = new Date(agora.getTime() - 7 * 86_400_000);

  const [usuarios, falhas] = await Promise.all([
    prisma.user.findMany({
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      include: {
        _count: { select: { tokensMcp: { where: { revogadoEm: null } } } },
        sessions: { where: { expiresAt: { gt: agora } }, select: { id: true } },
      },
    }),
    prisma.loginEvent.groupBy({
      by: ["email"],
      where: { success: false, createdAt: { gte: seteDias } },
      _count: true,
    }),
  ]);
  const falhasPor = new Map(falhas.map((f) => [f.email, f._count]));

  return usuarios.map((u) => ({
    id: u.id,
    nome: u.name,
    email: u.email,
    papel: u.role as Papel,
    ativo: u.isActive,
    criadoEm: u.createdAt,
    ultimoLoginEm: u.lastLoginAt,
    sessoesAtivas: u.sessions.length,
    tokensAtivos: u._count.tokensMcp,
    falhas7d: falhasPor.get(u.email) ?? 0,
  }));
}

/**
 * E-mails que TENTARAM entrar e não existem — a pergunta "quem está batendo na
 * porta?" respondida com dado, em vez de esperar a pessoa reclamar duas vezes.
 * Foi assim que se descobriu que o Diego nunca tinha conta.
 */
export async function batendoNaPorta(dias = 30): Promise<
  Array<{ email: string; tentativas: number; ultimaEm: Date }>
> {
  const desde = new Date(Date.now() - dias * 86_400_000);
  const linhas = await prisma.loginEvent.groupBy({
    by: ["email"],
    where: { success: false, reason: "e-mail inexistente", createdAt: { gte: desde } },
    _count: true,
    _max: { createdAt: true },
    orderBy: { _max: { createdAt: "desc" } },
    take: 10,
  });
  return linhas.map((l) => ({
    email: l.email,
    tentativas: l._count,
    ultimaEm: l._max.createdAt!,
  }));
}

async function contarAdminsAtivos(): Promise<number> {
  return prisma.user.count({ where: { role: "ADMIN", isActive: true } });
}

export async function criarUsuario(
  dados: { nome: string; email: string; senha: string; papel: Papel },
  ctx: { quem: string; origem: Origem },
): Promise<UsuarioListado> {
  const erro = validarNovoUsuario(dados);
  if (erro) throw new Error(erro);

  const email = normalizarEmail(dados.email);
  if (await prisma.user.findUnique({ where: { email } })) {
    throw new Error(`Já existe usuário com o e-mail ${email}.`);
  }

  const criado = await prisma.user.create({
    data: {
      email,
      name: dados.nome.trim(),
      passwordHash: await hashSenha(dados.senha),
      role: dados.papel,
      isActive: true,
    },
  });

  // ⚠ Nada de senha nem de hash no rastro: o que interessa é quem ganhou acesso.
  await registrarMudanca({
    entidade: "usuario",
    chave: email,
    acao: "criou",
    depois: { nome: criado.name, papel: criado.role },
    quem: ctx.quem,
    origem: ctx.origem,
  });

  return (await listarUsuarios()).find((u) => u.id === criado.id)!;
}

export async function atualizarUsuario(
  id: string,
  mudanca: { nome?: string; papel?: Papel; ativo?: boolean },
  ctx: { quem: string; origem: Origem; euId: string },
): Promise<UsuarioListado> {
  const antes = await prisma.user.findUnique({ where: { id } });
  if (!antes) throw new Error("Usuário não encontrado.");

  const barrado = impedimento({
    alvo: { id: antes.id, papel: antes.role as Papel, ativo: antes.isActive },
    mudanca: { papel: mudanca.papel, ativo: mudanca.ativo },
    euId: ctx.euId,
    adminsAtivos: await contarAdminsAtivos(),
  });
  if (barrado) throw new Error(barrado);

  const nome = mudanca.nome === undefined ? antes.name : mudanca.nome.trim();
  if (!nome) throw new Error("Informe o nome.");

  const depois = await prisma.user.update({
    where: { id },
    data: {
      name: nome,
      role: mudanca.papel ?? antes.role,
      isActive: mudanca.ativo ?? antes.isActive,
    },
  });

  /**
   * ⚠ Desativar ou trocar o perfil **encerra as sessões** do usuário.
   *
   * `usuarioAtual()` já confere `isActive` a cada chamada, então desativar tem
   * efeito imediato de qualquer forma; a troca de PERFIL é que não tinha efeito
   * até a sessão expirar (12h) — a pessoa seguia com as permissões antigas.
   */
  if (depois.role !== antes.role || depois.isActive !== antes.isActive) {
    await prisma.session.deleteMany({ where: { userId: id } });
  }

  await registrarMudanca({
    entidade: "usuario",
    chave: antes.email,
    acao: "alterou",
    antes: { nome: antes.name, papel: antes.role, ativo: antes.isActive },
    depois: { nome: depois.name, papel: depois.role, ativo: depois.isActive },
    quem: ctx.quem,
    origem: ctx.origem,
  });

  return (await listarUsuarios()).find((u) => u.id === id)!;
}

/**
 * Redefine a senha de OUTRA pessoa — o caminho de "esqueci a senha", que não
 * existe por e-mail (o painel não manda e-mail).
 *
 * Encerra todas as sessões dela: se a redefinição foi porque a conta pode ter
 * vazado, deixar a sessão antiga viva anula o motivo.
 */
export async function redefinirSenhaDe(
  id: string,
  senha: string,
  ctx: { quem: string; origem: Origem },
): Promise<void> {
  const alvo = await prisma.user.findUnique({ where: { id } });
  if (!alvo) throw new Error("Usuário não encontrado.");
  const erro = validarNovoUsuario({ nome: alvo.name, email: alvo.email, senha, papel: alvo.role });
  if (erro) throw new Error(erro);

  await prisma.user.update({ where: { id }, data: { passwordHash: await hashSenha(senha) } });
  await prisma.session.deleteMany({ where: { userId: id } });

  await registrarMudanca({
    entidade: "usuario",
    chave: alvo.email,
    acao: "alterou",
    depois: { senha: "redefinida por administrador" },
    quem: ctx.quem,
    origem: ctx.origem,
  });
}
