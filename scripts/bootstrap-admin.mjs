#!/usr/bin/env node
/**
 * Cria o primeiro administrador, se ADMIN_EMAIL/ADMIN_PASSWORD estiverem
 * definidos. Idempotente: não faz nada se o usuário já existir, e NUNCA
 * sobrescreve a senha de alguém.
 *
 * Sem isto um deploy novo sobe sem NENHUM usuário e é impossível entrar no
 * painel. Roda no entrypoint, a cada boot.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
const senha = process.env.ADMIN_PASSWORD ?? "";

if (!email || !senha) {
  console.log("[bootstrap-admin] ADMIN_EMAIL/ADMIN_PASSWORD ausentes — nada a fazer.");
  process.exit(0);
}
if (senha.length < 8) {
  console.error("[bootstrap-admin] ERRO: ADMIN_PASSWORD deve ter ao menos 8 caracteres.");
  process.exit(1);
}

const prisma = new PrismaClient();
try {
  const existente = await prisma.user.findUnique({ where: { email } });
  if (existente) {
    console.log(`[bootstrap-admin] Usuário ${email} já existe — senha preservada.`);
  } else {
    await prisma.user.create({
      data: {
        email,
        name: process.env.ADMIN_NAME?.trim() || "Administrador",
        passwordHash: await bcrypt.hash(senha, 12),
        role: "ADMIN",
      },
    });
    console.log(`[bootstrap-admin] Administrador ${email} criado.`);
  }
} catch (err) {
  console.error("[bootstrap-admin] ERRO:", err?.message ?? err);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
