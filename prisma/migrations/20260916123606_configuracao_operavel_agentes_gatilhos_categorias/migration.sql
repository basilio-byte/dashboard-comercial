-- CreateEnum
CREATE TYPE "FamiliaRegra" AS ENUM ('MARCO_CONTRATO', 'TENDENCIA', 'USO_SEM_COTA', 'PRIMEIRO_EVENTO', 'EVENTO_EM_SEGMENTO', 'EXCEDENTE', 'SALDO_COTA');

-- CreateEnum
CREATE TYPE "SegmentoCategoria" AS ENUM ('SALA_PRIVATIVA', 'ENDERECO_FISCAL', 'SEABOX', 'DEPOSITO', 'SERVICOS_DE_ESPACO', 'OUTRO', 'IGNORAR');

-- AlterTable
ALTER TABLE "contatos" ADD COLUMN     "agenteId" TEXT;

-- CreateTable
CREATE TABLE "agentes" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT,
    "apelido" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "clickupUserId" TEXT,
    "chatwootAgentId" TEXT,
    "observacao" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "criadoPor" TEXT,

    CONSTRAINT "agentes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gatilhos" (
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "familia" "FamiliaRegra" NOT NULL,
    "oferta" TEXT NOT NULL,
    "condicao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "params" JSONB NOT NULL DEFAULT '{}',
    "peso" INTEGER NOT NULL DEFAULT 50,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "nativo" BOOLEAN NOT NULL DEFAULT true,
    "nota" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "atualizadoPor" TEXT,

    CONSTRAINT "gatilhos_pkey" PRIMARY KEY ("codigo")
);

-- CreateTable
CREATE TABLE "categoria_classificacoes" (
    "serviceCategoryConexaId" INTEGER NOT NULL,
    "segmento" "SegmentoCategoria" NOT NULL,
    "rotulo" TEXT,
    "unidade" TEXT,
    "nota" TEXT,
    "definidoPor" TEXT,
    "definidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categoria_classificacoes_pkey" PRIMARY KEY ("serviceCategoryConexaId")
);

-- CreateTable
CREATE TABLE "mudancas_de_config" (
    "id" TEXT NOT NULL,
    "entidade" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "acao" TEXT NOT NULL,
    "antes" JSONB,
    "depois" JSONB,
    "quem" TEXT,
    "origem" TEXT NOT NULL DEFAULT 'UI',
    "em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mudancas_de_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agentes_email_key" ON "agentes"("email");

-- CreateIndex
CREATE INDEX "agentes_ativo_idx" ON "agentes"("ativo");

-- CreateIndex
CREATE INDEX "gatilhos_ativo_idx" ON "gatilhos"("ativo");

-- CreateIndex
CREATE INDEX "categoria_classificacoes_segmento_idx" ON "categoria_classificacoes"("segmento");

-- CreateIndex
CREATE INDEX "categoria_classificacoes_unidade_idx" ON "categoria_classificacoes"("unidade");

-- CreateIndex
CREATE INDEX "mudancas_de_config_entidade_em_idx" ON "mudancas_de_config"("entidade", "em");

-- CreateIndex
CREATE INDEX "mudancas_de_config_em_idx" ON "mudancas_de_config"("em");

-- CreateIndex
CREATE INDEX "contatos_agenteId_idx" ON "contatos"("agenteId");

-- AddForeignKey
ALTER TABLE "contatos" ADD CONSTRAINT "contatos_agenteId_fkey" FOREIGN KEY ("agenteId") REFERENCES "agentes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
