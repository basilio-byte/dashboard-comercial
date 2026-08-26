import "server-only";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import type { UserRole } from "@prisma/client";

const COOKIE = "seahub_comercial_sessao";
const DURACAO_MS = 1000 * 60 * 60 * 12; // 12h

export interface UsuarioDaSessao {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

export async function criarSessao(userId: string, meta: { ip?: string; userAgent?: string }) {
  const sessao = await prisma.session.create({
    data: {
      userId,
      expiresAt: new Date(Date.now() + DURACAO_MS),
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    },
  });
  const jar = await cookies();
  jar.set(COOKIE, sessao.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: sessao.expiresAt,
  });
  return sessao;
}

/**
 * Usuário da sessão atual, ou null.
 *
 * Confere `expiresAt` E `isActive` a cada chamada: desativar um usuário precisa
 * ter efeito imediato, não só no próximo login.
 */
export async function usuarioAtual(): Promise<UsuarioDaSessao | null> {
  const jar = await cookies();
  const id = jar.get(COOKIE)?.value;
  if (!id) return null;

  const sessao = await prisma.session.findUnique({
    where: { id },
    include: { user: true },
  });
  if (!sessao || sessao.expiresAt < new Date() || !sessao.user.isActive) return null;

  return {
    id: sessao.user.id,
    email: sessao.user.email,
    name: sessao.user.name,
    role: sessao.user.role,
  };
}

export async function encerrarSessao() {
  const jar = await cookies();
  const id = jar.get(COOKIE)?.value;
  if (id) await prisma.session.deleteMany({ where: { id } });
  jar.delete(COOKIE);
}

export const NOME_COOKIE_SESSAO = COOKIE;
