-- CreateEnum
CREATE TYPE "ResultadoContato" AS ENUM ('FALOU', 'SEM_RESPOSTA', 'INTERESSADO', 'RECUSOU', 'FECHOU');

-- CreateTable
CREATE TABLE "contatos" (
    "id" TEXT NOT NULL,
    "customerConexaId" INTEGER NOT NULL,
    "contatoEm" TIMESTAMP(3) NOT NULL,
    "quem" TEXT NOT NULL,
    "regra" TEXT,
    "resultado" "ResultadoContato" NOT NULL,
    "nota" TEXT,
    "registradoPor" TEXT,
    "registradoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contatos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contatos_customerConexaId_contatoEm_idx" ON "contatos"("customerConexaId", "contatoEm");

-- AddForeignKey
ALTER TABLE "contatos" ADD CONSTRAINT "contatos_customerConexaId_fkey" FOREIGN KEY ("customerConexaId") REFERENCES "dim_customers"("conexaId") ON DELETE CASCADE ON UPDATE CASCADE;

