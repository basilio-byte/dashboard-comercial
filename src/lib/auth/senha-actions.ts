"use server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { conferirSenha, hashSenha } from "./password";
import { NOME_COOKIE_SESSAO, usuarioAtual } from "./session";

export interface EstadoSenha {
  erro?: string;
  ok?: string;
}

const MINIMO = 8;

/**
 * Troca a própria senha.
 *
 * Três decisões que não são detalhe:
 *
 * 1. **Exige a senha ATUAL.** Sem isso, quem pegasse uma sessão aberta —
 *    máquina destravada, cookie roubado — trocaria a senha e tomaria a conta.
 *    O cookie prova "alguém está logado", não "é o dono".
 * 2. **Revoga as OUTRAS sessões, mantém a atual.** Trocar senha é a reação a
 *    "acho que vazou"; se as sessões antigas continuassem válidas, a troca não
 *    resolveria nada. Manter a atual evita derrubar quem acabou de trocar.
 * 3. **Não diz se a senha atual está errada por ser curta ou incorreta** — uma
 *    mensagem só.
 */
export async function trocarSenha(_anterior: EstadoSenha, form: FormData): Promise<EstadoSenha> {
  const usuario = await usuarioAtual();
  if (!usuario) return { erro: "Sessão expirada. Entre novamente." };

  const atual = String(form.get("atual") ?? "");
  const nova = String(form.get("nova") ?? "");
  const confirmacao = String(form.get("confirmacao") ?? "");

  if (!atual || !nova) return { erro: "Preencha os dois campos." };
  if (nova.length < MINIMO) return { erro: `A nova senha precisa de ao menos ${MINIMO} caracteres.` };
  if (nova !== confirmacao) return { erro: "A confirmação não confere com a nova senha." };
  if (nova === atual) return { erro: "A nova senha é igual à atual." };

  const registro = await prisma.user.findUnique({ where: { id: usuario.id } });
  if (!registro) return { erro: "Usuário não encontrado." };

  if (!(await conferirSenha(atual, registro.passwordHash))) {
    await prisma.loginEvent.create({
      data: { userId: usuario.id, email: usuario.email, success: false, reason: "troca de senha: senha atual incorreta" },
    });
    return { erro: "Senha atual incorreta." };
  }

  const jar = await cookies();
  const sessaoAtual = jar.get(NOME_COOKIE_SESSAO)?.value ?? "";

  await prisma.$transaction([
    prisma.user.update({
      where: { id: usuario.id },
      data: { passwordHash: await hashSenha(nova) },
    }),
    // Todas as outras sessões caem. A atual sobrevive.
    prisma.session.deleteMany({
      where: { userId: usuario.id, id: { not: sessaoAtual } },
    }),
    prisma.loginEvent.create({
      data: { userId: usuario.id, email: usuario.email, success: true, reason: "senha alterada" },
    }),
  ]);

  return { ok: "Senha alterada. As outras sessões deste usuário foram encerradas." };
}
