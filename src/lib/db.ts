import "server-only";
import { PrismaClient } from "@prisma/client";

// Em desenvolvimento o hot-reload recria módulos; sem o singleton, cada reload
// abriria um novo pool de conexões até estourar o limite do Postgres.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
