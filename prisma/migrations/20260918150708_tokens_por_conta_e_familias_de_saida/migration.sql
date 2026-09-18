-- CreateEnum
CREATE TYPE "EscopoToken" AS ENUM ('LEITURA', 'ESCRITA');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FamiliaRegra" ADD VALUE 'MUDANCA_CONTRATO';
ALTER TYPE "FamiliaRegra" ADD VALUE 'SAUDE_FINANCEIRA';

-- CreateTable
CREATE TABLE "tokens_mcp" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "prefixo" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "escopo" "EscopoToken" NOT NULL DEFAULT 'LEITURA',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimoUsoEm" TIMESTAMP(3),
    "revogadoEm" TIMESTAMP(3),
    "revogadoPor" TEXT,

    CONSTRAINT "tokens_mcp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tokens_mcp_hash_key" ON "tokens_mcp"("hash");

-- CreateIndex
CREATE INDEX "tokens_mcp_userId_idx" ON "tokens_mcp"("userId");

-- AddForeignKey
ALTER TABLE "tokens_mcp" ADD CONSTRAINT "tokens_mcp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
