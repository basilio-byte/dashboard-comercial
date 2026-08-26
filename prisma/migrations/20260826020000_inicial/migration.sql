-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'COMERCIAL', 'VIEWER');

-- CreateEnum
CREATE TYPE "Procedencia" AS ENUM ('API', 'DERIVADO', 'MANUAL', 'INDISPONIVEL');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED', 'HALTED');

-- CreateEnum
CREATE TYPE "JanelaStatus" AS ENUM ('PENDENTE', 'EM_ANDAMENTO', 'CONCLUIDA', 'FALHOU');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'VIEWER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" TEXT,
    "ip" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "reason" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dim_companies" (
    "conexaId" INTEGER NOT NULL,
    "name" TEXT,
    "raw" JSONB NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dim_companies_pkey" PRIMARY KEY ("conexaId")
);

-- CreateTable
CREATE TABLE "dim_service_categories" (
    "conexaId" INTEGER NOT NULL,
    "name" TEXT,
    "raw" JSONB NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dim_service_categories_pkey" PRIMARY KEY ("conexaId")
);

-- CreateTable
CREATE TABLE "dim_plans" (
    "conexaId" INTEGER NOT NULL,
    "companyConexaId" INTEGER,
    "name" TEXT,
    "serviceCategoryConexaId" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "horasInclusasMes" DECIMAL(10,2),
    "hourQuotasRaw" JSONB,
    "raw" JSONB NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dim_plans_pkey" PRIMARY KEY ("conexaId")
);

-- CreateTable
CREATE TABLE "dim_products" (
    "conexaId" INTEGER NOT NULL,
    "companyConexaId" INTEGER,
    "name" TEXT,
    "serviceCategoryConexaId" INTEGER,
    "price" DECIMAL(14,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "raw" JSONB NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dim_products_pkey" PRIMARY KEY ("conexaId")
);

-- CreateTable
CREATE TABLE "dim_customers" (
    "conexaId" INTEGER NOT NULL,
    "companyConexaId" INTEGER,
    "name" TEXT,
    "tradeName" TEXT,
    "document" TEXT,
    "isJuridicalPerson" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "city" TEXT,
    "state" TEXT,
    "createdAtConexa" TIMESTAMP(3),
    "raw" JSONB NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dim_customers_pkey" PRIMARY KEY ("conexaId")
);

-- CreateTable
CREATE TABLE "fact_contracts" (
    "conexaId" INTEGER NOT NULL,
    "customerConexaId" INTEGER,
    "planConexaId" INTEGER,
    "companyConexaId" INTEGER,
    "costCenterConexaId" INTEGER,
    "sellerId" INTEGER,
    "amount" DECIMAL(14,2) NOT NULL,
    "paymentFrequency" TEXT,
    "startDate" DATE,
    "endDate" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "dueDay" INTEGER,
    "fidelityDate" DATE,
    "contractSummary" TEXT,
    "hourPlanQuotaRaw" JSONB,
    "createdAtConexa" TIMESTAMP(3),
    "updatedAtConexa" TIMESTAMP(3),
    "raw" JSONB NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fact_contracts_pkey" PRIMARY KEY ("conexaId")
);

-- CreateTable
CREATE TABLE "fact_sales" (
    "conexaId" INTEGER NOT NULL,
    "customerConexaId" INTEGER,
    "productConexaId" INTEGER,
    "contractConexaId" INTEGER,
    "recurringSaleId" INTEGER,
    "sellerId" INTEGER,
    "amount" DECIMAL(14,2) NOT NULL,
    "originalAmount" DECIMAL(14,2),
    "discountValue" DECIMAL(14,2),
    "quantity" DECIMAL(14,4),
    "status" TEXT,
    "referenceDate" TIMESTAMP(3),
    "createdAtConexa" TIMESTAMP(3),
    "updatedAtConexa" TIMESTAMP(3),
    "raw" JSONB NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fact_sales_pkey" PRIMARY KEY ("conexaId")
);

-- CreateTable
CREATE TABLE "fact_charges" (
    "conexaId" INTEGER NOT NULL,
    "companyConexaId" INTEGER,
    "customerConexaId" INTEGER,
    "status" TEXT,
    "type" TEXT,
    "receivingMethod" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "currentAmount" DECIMAL(14,2),
    "paidAmount" DECIMAL(14,2),
    "competenceDate" DATE,
    "dueDate" DATE,
    "paymentDate" DATE,
    "cancelDate" DATE,
    "emissionDate" DATE,
    "salesIds" INTEGER[],
    "createdAtConexa" TIMESTAMP(3),
    "updatedAtConexa" TIMESTAMP(3),
    "raw" JSONB NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fact_charges_pkey" PRIMARY KEY ("conexaId")
);

-- CreateTable
CREATE TABLE "fact_room_bookings" (
    "conexaId" INTEGER NOT NULL,
    "customerConexaId" INTEGER,
    "personConexaId" INTEGER,
    "saleConexaId" INTEGER,
    "placeConexaId" INTEGER,
    "placeName" TEXT,
    "status" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isBilled" BOOLEAN NOT NULL DEFAULT false,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "cancellationReason" TEXT,
    "recurringBookingId" INTEGER,
    "startTime" TIMESTAMP(3),
    "finalTime" TIMESTAMP(3),
    "horas" DECIMAL(10,4),
    "dataLocal" DATE,
    "createdAtConexa" TIMESTAMP(3),
    "updatedAtConexa" TIMESTAMP(3),
    "raw" JSONB NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fact_room_bookings_pkey" PRIMARY KEY ("conexaId")
);

-- CreateTable
CREATE TABLE "intel_customer_monthly_revenue" (
    "id" TEXT NOT NULL,
    "customerConexaId" INTEGER NOT NULL,
    "mesKey" TEXT NOT NULL,
    "receita" DECIMAL(14,2) NOT NULL,
    "cobrancas" INTEGER NOT NULL DEFAULT 0,
    "variacaoPct" DECIMAL(10,4),
    "procedencia" "Procedencia" NOT NULL DEFAULT 'DERIVADO',
    "calculadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intel_customer_monthly_revenue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intel_customer_profile" (
    "customerConexaId" INTEGER NOT NULL,
    "receitaAnoCorrente" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "receita12Meses" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "ultimoMesComReceita" TEXT,
    "segmentos" TEXT[],
    "horasInclusasMes" DECIMAL(10,2),
    "temContratoAtivo" BOOLEAN NOT NULL DEFAULT false,
    "contratosAtivos" INTEGER NOT NULL DEFAULT 0,
    "contratoDesde" DATE,
    "procedencia" "Procedencia" NOT NULL DEFAULT 'DERIVADO',
    "calculadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intel_customer_profile_pkey" PRIMARY KEY ("customerConexaId")
);

-- CreateTable
CREATE TABLE "sync_runs" (
    "id" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "entity" TEXT,
    "status" "SyncStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "requestsMade" INTEGER NOT NULL DEFAULT 0,
    "recordsRead" INTEGER NOT NULL DEFAULT 0,
    "recordsWrote" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "detail" JSONB,
    "ownerId" TEXT,
    "heartbeatAt" TIMESTAMP(3),

    CONSTRAINT "sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_windows" (
    "entidade" TEXT NOT NULL,
    "janela" TEXT NOT NULL,
    "status" "JanelaStatus" NOT NULL DEFAULT 'PENDENTE',
    "offset" INTEGER NOT NULL DEFAULT 0,
    "registros" INTEGER NOT NULL DEFAULT 0,
    "erro" TEXT,
    "iniciadaEm" TIMESTAMP(3),
    "concluidaEm" TIMESTAMP(3),
    "atualizadaEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_windows_pkey" PRIMARY KEY ("entidade","janela")
);

-- CreateTable
CREATE TABLE "sync_state" (
    "key" TEXT NOT NULL,
    "cursor" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "detail" JSONB,

    CONSTRAINT "sync_state_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE INDEX "login_events_email_idx" ON "login_events"("email");

-- CreateIndex
CREATE INDEX "login_events_createdAt_idx" ON "login_events"("createdAt");

-- CreateIndex
CREATE INDEX "dim_plans_serviceCategoryConexaId_idx" ON "dim_plans"("serviceCategoryConexaId");

-- CreateIndex
CREATE INDEX "dim_plans_companyConexaId_idx" ON "dim_plans"("companyConexaId");

-- CreateIndex
CREATE INDEX "dim_products_serviceCategoryConexaId_idx" ON "dim_products"("serviceCategoryConexaId");

-- CreateIndex
CREATE INDEX "dim_products_companyConexaId_idx" ON "dim_products"("companyConexaId");

-- CreateIndex
CREATE INDEX "dim_customers_companyConexaId_idx" ON "dim_customers"("companyConexaId");

-- CreateIndex
CREATE INDEX "dim_customers_isActive_isBlocked_idx" ON "dim_customers"("isActive", "isBlocked");

-- CreateIndex
CREATE INDEX "fact_contracts_customerConexaId_idx" ON "fact_contracts"("customerConexaId");

-- CreateIndex
CREATE INDEX "fact_contracts_isActive_idx" ON "fact_contracts"("isActive");

-- CreateIndex
CREATE INDEX "fact_contracts_startDate_idx" ON "fact_contracts"("startDate");

-- CreateIndex
CREATE INDEX "fact_contracts_endDate_idx" ON "fact_contracts"("endDate");

-- CreateIndex
CREATE INDEX "fact_contracts_planConexaId_idx" ON "fact_contracts"("planConexaId");

-- CreateIndex
CREATE INDEX "fact_sales_customerConexaId_idx" ON "fact_sales"("customerConexaId");

-- CreateIndex
CREATE INDEX "fact_sales_productConexaId_idx" ON "fact_sales"("productConexaId");

-- CreateIndex
CREATE INDEX "fact_sales_contractConexaId_idx" ON "fact_sales"("contractConexaId");

-- CreateIndex
CREATE INDEX "fact_sales_referenceDate_idx" ON "fact_sales"("referenceDate");

-- CreateIndex
CREATE INDEX "fact_charges_customerConexaId_idx" ON "fact_charges"("customerConexaId");

-- CreateIndex
CREATE INDEX "fact_charges_companyConexaId_idx" ON "fact_charges"("companyConexaId");

-- CreateIndex
CREATE INDEX "fact_charges_status_idx" ON "fact_charges"("status");

-- CreateIndex
CREATE INDEX "fact_charges_emissionDate_idx" ON "fact_charges"("emissionDate");

-- CreateIndex
CREATE INDEX "fact_charges_paymentDate_idx" ON "fact_charges"("paymentDate");

-- CreateIndex
CREATE INDEX "fact_room_bookings_customerConexaId_dataLocal_idx" ON "fact_room_bookings"("customerConexaId", "dataLocal");

-- CreateIndex
CREATE INDEX "fact_room_bookings_status_idx" ON "fact_room_bookings"("status");

-- CreateIndex
CREATE INDEX "fact_room_bookings_dataLocal_idx" ON "fact_room_bookings"("dataLocal");

-- CreateIndex
CREATE INDEX "intel_customer_monthly_revenue_mesKey_idx" ON "intel_customer_monthly_revenue"("mesKey");

-- CreateIndex
CREATE UNIQUE INDEX "intel_customer_monthly_revenue_customerConexaId_mesKey_key" ON "intel_customer_monthly_revenue"("customerConexaId", "mesKey");

-- CreateIndex
CREATE INDEX "intel_customer_profile_receitaAnoCorrente_idx" ON "intel_customer_profile"("receitaAnoCorrente");

-- CreateIndex
CREATE INDEX "sync_runs_entity_status_finishedAt_idx" ON "sync_runs"("entity", "status", "finishedAt");

-- CreateIndex
CREATE INDEX "sync_runs_startedAt_idx" ON "sync_runs"("startedAt");

-- CreateIndex
CREATE INDEX "sync_windows_entidade_status_idx" ON "sync_windows"("entidade", "status");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_events" ADD CONSTRAINT "login_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_contracts" ADD CONSTRAINT "fact_contracts_customerConexaId_fkey" FOREIGN KEY ("customerConexaId") REFERENCES "dim_customers"("conexaId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intel_customer_monthly_revenue" ADD CONSTRAINT "intel_customer_monthly_revenue_customerConexaId_fkey" FOREIGN KEY ("customerConexaId") REFERENCES "dim_customers"("conexaId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intel_customer_profile" ADD CONSTRAINT "intel_customer_profile_customerConexaId_fkey" FOREIGN KEY ("customerConexaId") REFERENCES "dim_customers"("conexaId") ON DELETE CASCADE ON UPDATE CASCADE;

