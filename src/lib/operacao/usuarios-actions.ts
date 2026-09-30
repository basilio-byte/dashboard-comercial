"use server";
import { revalidatePath } from "next/cache";
import { usuarioAtual } from "@/lib/auth/session";
import {
  atualizarUsuario,
  criarUsuario,
  redefinirSenhaDe,
} from "./usuarios";
import type { Papel } from "./usuarios-regras";

/**
 * Ações da tela Usuários. **Só ADMIN**, conferido aqui dentro.
 *
 * ⚠ A verificação não pode viver só na página: uma server action é um endpoint,
 * e quem souber o nome dela a chama sem passar pela tela.
 */
async function admin() {
  const u = await usuarioAtual();
  if (!u) throw new Error("Sessão expirada.");
  if (u.role !== "ADMIN") throw new Error("Só um administrador administra usuários.");
  return u;
}

export async function acaoCriarUsuario(dados: {
  nome: string;
  email: string;
  senha: string;
  papel: Papel;
}) {
  const eu = await admin();
  const criado = await criarUsuario(dados, { quem: eu.email, origem: "UI" });
  revalidatePath("/usuarios");
  return { id: criado.id, email: criado.email };
}

export async function acaoAtualizarUsuario(
  id: string,
  mudanca: { nome?: string; papel?: Papel; ativo?: boolean },
) {
  const eu = await admin();
  await atualizarUsuario(id, mudanca, { quem: eu.email, origem: "UI", euId: eu.id });
  revalidatePath("/usuarios");
}

export async function acaoRedefinirSenha(id: string, senha: string) {
  const eu = await admin();
  await redefinirSenhaDe(id, senha, { quem: eu.email, origem: "UI" });
  revalidatePath("/usuarios");
}
