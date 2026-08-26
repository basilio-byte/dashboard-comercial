import "server-only";
import bcrypt from "bcryptjs";

const CUSTO = 12;

export function hashSenha(senha: string): Promise<string> {
  return bcrypt.hash(senha, CUSTO);
}

export function conferirSenha(senha: string, hash: string): Promise<boolean> {
  return bcrypt.compare(senha, hash);
}

/**
 * Hash-isca: um bcrypt real, para o login gastar o MESMO tempo quando o e-mail
 * não existe. Sem isto, a diferença de tempo entre "e-mail inexistente" (rápido)
 * e "senha errada" (lento) permite enumerar quem tem conta.
 */
export const HASH_ISCA = "$2a$12$C6UzMDM.H6dfI/f/IKcEe.5Sd/6Z3JZ1JZ1JZ1JZ1JZ1JZ1JZ1JZ1";
