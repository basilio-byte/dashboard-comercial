"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { conferirSenha, HASH_ISCA } from "./password";
import { criarSessao, encerrarSessao } from "./session";

export interface EstadoLogin {
  erro?: string;
}

export async function entrar(_anterior: EstadoLogin, form: FormData): Promise<EstadoLogin> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const senha = String(form.get("senha") ?? "");

  if (!email || !senha) return { erro: "Informe e-mail e senha." };

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = h.get("user-agent");

  const usuario = await prisma.user.findUnique({ where: { email } });

  // Roda bcrypt SEMPRE, mesmo sem usuário — com um hash-isca. Sem isso, a
  // diferença de tempo entre "e-mail não existe" e "senha errada" vaza quem tem
  // conta na empresa.
  const ok = await conferirSenha(senha, usuario?.passwordHash ?? HASH_ISCA);

  const registrar = (success: boolean, reason?: string) =>
    prisma.loginEvent.create({
      data: { userId: usuario?.id ?? null, email, success, reason: reason ?? null, ip, userAgent },
    });

  if (!usuario || !ok) {
    await registrar(false, !usuario ? "e-mail inexistente" : "senha incorreta");
    // Mensagem única de propósito: dizer qual dos dois falhou é a mesma fuga.
    return { erro: "E-mail ou senha inválidos." };
  }
  if (!usuario.isActive) {
    await registrar(false, "usuário desativado");
    return { erro: "Usuário desativado. Procure um administrador." };
  }

  await registrar(true);
  await prisma.user.update({ where: { id: usuario.id }, data: { lastLoginAt: new Date() } });
  await criarSessao(usuario.id, { ip: ip ?? undefined, userAgent: userAgent ?? undefined });

  redirect("/");
}

export async function sair() {
  await encerrarSessao();
  redirect("/login");
}
