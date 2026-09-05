-- Administration module build-out:
--   * Exchange Rates & Indexes -> the Indexes tab
--   * License folder           -> License Administration, Add-On Identifier
--                                 Generator, Support User Log
--   * Utilities                -> Period-End Closing runs
--
-- Every table is tenant-scoped and cascades from companies, matching the rest
-- of the schema: deleting a tenant must not strand its administration rows.

-- --- ENUMS -------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "AddOnType" AS ENUM ('DEVELOPMENT', 'IMPLEMENTATION', 'SOLUTION');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PeriodEndClosingStatus" AS ENUM ('PREVIEW', 'EXECUTED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --- INDEXES (the "Indexes" tab) ---------------------------------------------
CREATE TABLE IF NOT EXISTS "financial_indexes" (
  "id"          TEXT NOT NULL,
  "companyId"   TEXT NOT NULL,
  "code"        TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "baseYear"    INTEGER,
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "financial_indexes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "financial_indexes_companyId_code_key"
  ON "financial_indexes" ("companyId", "code");
CREATE INDEX IF NOT EXISTS "financial_indexes_companyId_idx"
  ON "financial_indexes" ("companyId");
CREATE UNIQUE INDEX IF NOT EXISTS "financial_indexes_companyId_id_key"
  ON "financial_indexes" ("companyId", "id");

CREATE TABLE IF NOT EXISTS "financial_index_values" (
  "id"        TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "indexId"   TEXT NOT NULL,
  "year"      INTEGER NOT NULL,
  "month"     INTEGER NOT NULL,
  "value"     DECIMAL(18,6) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "financial_index_values_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "financial_index_values_indexId_year_month_key"
  ON "financial_index_values" ("indexId", "year", "month");
CREATE INDEX IF NOT EXISTS "financial_index_values_companyId_year_idx"
  ON "financial_index_values" ("companyId", "year");

-- A month outside 1-12 would silently create a thirteenth row per year that the
-- grid can never show. Rejected at the database, not only in the DTO.
ALTER TABLE "financial_index_values"
  DROP CONSTRAINT IF EXISTS "financial_index_values_month_range";
ALTER TABLE "financial_index_values"
  ADD CONSTRAINT "financial_index_values_month_range"
  CHECK ("month" >= 1 AND "month" <= 12);

-- --- LICENSE -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "company_licenses" (
  "id"                 TEXT NOT NULL,
  "companyId"          TEXT NOT NULL,
  "licenseKey"         TEXT NOT NULL,
  "licenseServer"      TEXT,
  "port"               INTEGER DEFAULT 40000,
  "hardwareKey"        TEXT,
  "installationNumber" TEXT,
  "systemNumber"       TEXT,
  "validFrom"          TIMESTAMP(3),
  "validTo"            TIMESTAMP(3),
  "isActive"           BOOLEAN NOT NULL DEFAULT true,
  "importedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "importedFileName"   TEXT,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "company_licenses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "company_licenses_companyId_licenseKey_key"
  ON "company_licenses" ("companyId", "licenseKey");
CREATE INDEX IF NOT EXISTS "company_licenses_companyId_idx"
  ON "company_licenses" ("companyId");

CREATE TABLE IF NOT EXISTS "license_components" (
  "id"         TEXT NOT NULL,
  "licenseId"  TEXT NOT NULL,
  "code"       TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "totalCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "license_components_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "license_components_licenseId_code_key"
  ON "license_components" ("licenseId", "code");

ALTER TABLE "license_components"
  DROP CONSTRAINT IF EXISTS "license_components_total_non_negative";
ALTER TABLE "license_components"
  ADD CONSTRAINT "license_components_total_non_negative"
  CHECK ("totalCount" >= 0);

CREATE TABLE IF NOT EXISTS "license_assignments" (
  "id"          TEXT NOT NULL,
  "companyId"   TEXT NOT NULL,
  "licenseId"   TEXT NOT NULL,
  "componentId" TEXT NOT NULL,
  "userId"      TEXT NOT NULL,
  "assignedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "license_assignments_pkey" PRIMARY KEY ("id")
);

-- One seat of a component per user: this uniqueness is what makes the "Used"
-- count on the Allocation tab trustworthy without a stored counter.
CREATE UNIQUE INDEX IF NOT EXISTS "license_assignments_componentId_userId_key"
  ON "license_assignments" ("componentId", "userId");
CREATE INDEX IF NOT EXISTS "license_assignments_companyId_idx"
  ON "license_assignments" ("companyId");
CREATE INDEX IF NOT EXISTS "license_assignments_userId_idx"
  ON "license_assignments" ("userId");

CREATE TABLE IF NOT EXISTS "add_on_identifiers" (
  "id"               TEXT NOT NULL,
  "companyId"        TEXT NOT NULL,
  "addOnName"        TEXT NOT NULL,
  "addOnType"        "AddOnType" NOT NULL DEFAULT 'DEVELOPMENT',
  "partnerNamespace" TEXT,
  "identifier"       TEXT NOT NULL,
  "generatedById"    TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "add_on_identifiers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "add_on_identifiers_companyId_identifier_key"
  ON "add_on_identifiers" ("companyId", "identifier");
CREATE INDEX IF NOT EXISTS "add_on_identifiers_companyId_idx"
  ON "add_on_identifiers" ("companyId");

CREATE TABLE IF NOT EXISTS "support_user_log" (
  "id"         TEXT NOT NULL,
  "companyId"  TEXT NOT NULL,
  "userId"     TEXT,
  "action"     TEXT NOT NULL,
  "detail"     TEXT,
  "metadata"   JSONB,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "support_user_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "support_user_log_companyId_occurredAt_idx"
  ON "support_user_log" ("companyId", "occurredAt");

-- --- UTILITIES: PERIOD-END CLOSING -------------------------------------------
CREATE TABLE IF NOT EXISTS "period_end_closing_runs" (
  "id"                        TEXT NOT NULL,
  "companyId"                 TEXT NOT NULL,
  "fromPeriodId"              TEXT NOT NULL,
  "toPeriodId"                TEXT NOT NULL,
  "retainedEarningsAccountId" TEXT NOT NULL,
  "closingAccountId"          TEXT,
  "usePrimaryClosingAccount"  BOOLEAN NOT NULL DEFAULT true,
  "status"                    "PeriodEndClosingStatus" NOT NULL DEFAULT 'PREVIEW',
  "lines"                     JSONB NOT NULL,
  "totalDebit"                DECIMAL(20,4) NOT NULL DEFAULT 0,
  "totalCredit"               DECIMAL(20,4) NOT NULL DEFAULT 0,
  "journalEntryId"            TEXT,
  "errorMessage"              TEXT,
  "executedById"              TEXT,
  "executedAt"                TIMESTAMP(3),
  "createdAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "period_end_closing_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "period_end_closing_runs_companyId_createdAt_idx"
  ON "period_end_closing_runs" ("companyId", "createdAt");

-- An executed run without a journal is a closing that claims to have posted and
-- did not - the one state that must never be reachable.
ALTER TABLE "period_end_closing_runs"
  DROP CONSTRAINT IF EXISTS "period_end_closing_runs_executed_has_journal";
ALTER TABLE "period_end_closing_runs"
  ADD CONSTRAINT "period_end_closing_runs_executed_has_journal"
  CHECK ("status" <> 'EXECUTED' OR "journalEntryId" IS NOT NULL);

-- --- FOREIGN KEYS ------------------------------------------------------------
ALTER TABLE "financial_indexes"
  DROP CONSTRAINT IF EXISTS "financial_indexes_companyId_fkey";
ALTER TABLE "financial_indexes"
  ADD CONSTRAINT "financial_indexes_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "financial_index_values"
  DROP CONSTRAINT IF EXISTS "financial_index_values_companyId_fkey";
ALTER TABLE "financial_index_values"
  ADD CONSTRAINT "financial_index_values_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "financial_index_values"
  DROP CONSTRAINT IF EXISTS "financial_index_values_indexId_fkey";
ALTER TABLE "financial_index_values"
  ADD CONSTRAINT "financial_index_values_indexId_fkey"
  FOREIGN KEY ("indexId") REFERENCES "financial_indexes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "company_licenses"
  DROP CONSTRAINT IF EXISTS "company_licenses_companyId_fkey";
ALTER TABLE "company_licenses"
  ADD CONSTRAINT "company_licenses_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "license_components"
  DROP CONSTRAINT IF EXISTS "license_components_licenseId_fkey";
ALTER TABLE "license_components"
  ADD CONSTRAINT "license_components_licenseId_fkey"
  FOREIGN KEY ("licenseId") REFERENCES "company_licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "license_assignments"
  DROP CONSTRAINT IF EXISTS "license_assignments_companyId_fkey";
ALTER TABLE "license_assignments"
  ADD CONSTRAINT "license_assignments_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "license_assignments"
  DROP CONSTRAINT IF EXISTS "license_assignments_licenseId_fkey";
ALTER TABLE "license_assignments"
  ADD CONSTRAINT "license_assignments_licenseId_fkey"
  FOREIGN KEY ("licenseId") REFERENCES "company_licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "license_assignments"
  DROP CONSTRAINT IF EXISTS "license_assignments_componentId_fkey";
ALTER TABLE "license_assignments"
  ADD CONSTRAINT "license_assignments_componentId_fkey"
  FOREIGN KEY ("componentId") REFERENCES "license_components"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "license_assignments"
  DROP CONSTRAINT IF EXISTS "license_assignments_userId_fkey";
ALTER TABLE "license_assignments"
  ADD CONSTRAINT "license_assignments_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "add_on_identifiers"
  DROP CONSTRAINT IF EXISTS "add_on_identifiers_companyId_fkey";
ALTER TABLE "add_on_identifiers"
  ADD CONSTRAINT "add_on_identifiers_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "add_on_identifiers"
  DROP CONSTRAINT IF EXISTS "add_on_identifiers_generatedById_fkey";
ALTER TABLE "add_on_identifiers"
  ADD CONSTRAINT "add_on_identifiers_generatedById_fkey"
  FOREIGN KEY ("generatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "support_user_log"
  DROP CONSTRAINT IF EXISTS "support_user_log_companyId_fkey";
ALTER TABLE "support_user_log"
  ADD CONSTRAINT "support_user_log_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "support_user_log"
  DROP CONSTRAINT IF EXISTS "support_user_log_userId_fkey";
ALTER TABLE "support_user_log"
  ADD CONSTRAINT "support_user_log_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "period_end_closing_runs"
  DROP CONSTRAINT IF EXISTS "period_end_closing_runs_companyId_fkey";
ALTER TABLE "period_end_closing_runs"
  ADD CONSTRAINT "period_end_closing_runs_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "period_end_closing_runs"
  DROP CONSTRAINT IF EXISTS "period_end_closing_runs_executedById_fkey";
ALTER TABLE "period_end_closing_runs"
  ADD CONSTRAINT "period_end_closing_runs_executedById_fkey"
  FOREIGN KEY ("executedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
