-- CreateTable
CREATE TABLE "reconciliacoes" (
    "id" TEXT NOT NULL,
    "mesKey" TEXT NOT NULL,
    "janela" TEXT NOT NULL DEFAULT 'vencimento',
    "executadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executadaPor" TEXT,
    "veredicto" TEXT NOT NULL,
    "localTotal" DECIMAL(14,2) NOT NULL,
    "localContagem" INTEGER NOT NULL,
    "remotoTotal" DECIMAL(14,2) NOT NULL,
    "remotoContagem" INTEGER NOT NULL,
    "diferenca" DECIMAL(14,2) NOT NULL,
    "divergencias" INTEGER NOT NULL DEFAULT 0,
    "detalhe" JSONB,
    "requisicoes" INTEGER NOT NULL DEFAULT 0,
    "observacao" TEXT,

    CONSTRAINT "reconciliacoes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reconciliacoes_mesKey_executadaEm_idx" ON "reconciliacoes"("mesKey", "executadaEm");

