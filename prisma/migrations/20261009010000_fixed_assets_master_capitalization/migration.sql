-- Fixed Assets FA-1: Asset Master Data, Asset Classes, Depreciation Areas,
-- Capitalization and Capitalization Credit Memo.
--
--   * fixed_assets loses its own accounts, currency and depreciation figures.
--     Accounts come from the asset's Asset Class; APC / accumulated
--     depreciation / net book value live per Depreciation Area in
--     fixed_asset_area_values. Amounts are in the company's local currency.
--   * asset_capitalizations (+ lines) are the posted documents behind
--     Capitalization and Capitalization Credit Memo; fixed_asset_transactions
--     is the append-only asset history.
--   * Every new link is a composite (companyId, id) foreign key, so no fixed
--     asset row can point at another company's record. branches, employees,
--     numbering_series and ap_bill_lines gain the (companyId, id) unique key
--     those references need.
--   * erp_apply_fixed_asset_defaults(company) gives every company the MAIN
--     depreciation area and the FA-/CAP-/CAPCM- numbering series. It is called
--     below for every existing company, by erp_bootstrap_financials, and by
--     the onboarding seeder. Asset classes are the accountant's to set up.
--   * The financials.fixed_assets permission set, attached to each company's
--     admin role; the Accountant set gains capitalization posting.
--
-- The old fixed_assets columns are dropped, not migrated: when this was
-- written, live had no fixed assets at all. The guard refuses to run
-- anywhere that is no longer true, rather than lose data.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "fixed_assets") OR EXISTS (SELECT 1 FROM "fixed_asset_transactions") THEN
    RAISE EXCEPTION 'fixed_assets is not empty: this migration drops its old value and account columns and needs a data migration first';
  END IF;
END $$;

-- CreateEnum
CREATE TYPE "AssetCapitalizationKind" AS ENUM ('CAPITALIZATION', 'CREDIT_MEMO');

-- CreateEnum
CREATE TYPE "AssetCapitalizationOrigin" AS ENUM ('MANUAL', 'AP_INVOICE');

-- CreateEnum
CREATE TYPE "AssetCapitalizationStatus" AS ENUM ('POSTED', 'CANCELLED');

-- DropForeignKey
ALTER TABLE "fixed_assets" DROP CONSTRAINT "fixed_assets_costAccountId_fkey";

-- DropForeignKey
ALTER TABLE "fixed_assets" DROP CONSTRAINT "fixed_assets_depreciationAccountId_fkey";

-- DropForeignKey
ALTER TABLE "fixed_assets" DROP CONSTRAINT "fixed_assets_accumulatedAccountId_fkey";

-- DropForeignKey
ALTER TABLE "fixed_assets" DROP CONSTRAINT "fixed_assets_costCenterId_fkey";

-- DropForeignKey
ALTER TABLE "fixed_asset_transactions" DROP CONSTRAINT "fixed_asset_transactions_assetId_fkey";

-- DropForeignKey
ALTER TABLE "fixed_asset_transactions" DROP CONSTRAINT "fixed_asset_transactions_journalEntryId_fkey";

-- DropIndex
DROP INDEX "fixed_assets_accumulatedAccountId_idx";

-- DropIndex
DROP INDEX "fixed_assets_costAccountId_idx";

-- DropIndex
DROP INDEX "fixed_assets_depreciationAccountId_idx";

-- DropIndex
DROP INDEX "fixed_asset_transactions_assetId_postingDate_idx";

-- AlterTable
ALTER TABLE "fixed_assets" DROP COLUMN "accumulatedAccountId",
DROP COLUMN "accumulatedDepreciation",
DROP COLUMN "acquisitionCost",
DROP COLUMN "assetClass",
DROP COLUMN "costAccountId",
DROP COLUMN "currency",
DROP COLUMN "depreciationAccountId",
DROP COLUMN "depreciationMethod",
DROP COLUMN "location",
DROP COLUMN "netBookValue",
DROP COLUMN "salvageValue",
DROP COLUMN "usefulLifeMonths",
ADD COLUMN     "additionalIdentifier" TEXT,
ADD COLUMN     "assetClassId" TEXT NOT NULL,
ADD COLUMN     "barCode" TEXT,
ADD COLUMN     "branchId" TEXT,
ADD COLUMN     "distributionRuleId" TEXT,
ADD COLUMN     "employeeId" TEXT,
ADD COLUMN     "foreignName" TEXT,
ADD COLUMN     "inventoryNo" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "manufacturer" TEXT,
ADD COLUMN     "mfrCatalogNo" TEXT,
ADD COLUMN     "projectId" TEXT,
ADD COLUMN     "purchaseCost" DECIMAL(19,4),
ADD COLUMN     "purchaseDate" TIMESTAMP(3),
ADD COLUMN     "quantity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "technicianId" TEXT,
ADD COLUMN     "vendorCardType" "BpCardType",
ADD COLUMN     "vendorId" TEXT;

-- AlterTable
ALTER TABLE "fixed_asset_transactions" ADD COLUMN     "areaId" TEXT,
ADD COLUMN     "capitalizationId" TEXT,
ADD COLUMN     "capitalizationLineId" TEXT,
ADD COLUMN     "companyId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "asset_classes" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "depreciationMethod" "DepreciationMethod" NOT NULL DEFAULT 'STRAIGHT_LINE',
    "usefulLifeMonths" INTEGER NOT NULL DEFAULT 60,
    "assetAccountId" TEXT NOT NULL,
    "accumulatedDepreciationAccountId" TEXT NOT NULL,
    "depreciationExpenseAccountId" TEXT NOT NULL,
    "clearingAccountId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "depreciation_areas" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "postsToGl" BOOLEAN NOT NULL DEFAULT false,
    "ordering" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "depreciation_areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_asset_area_values" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "depreciationMethod" "DepreciationMethod" NOT NULL DEFAULT 'STRAIGHT_LINE',
    "usefulLifeMonths" INTEGER NOT NULL DEFAULT 60,
    "depreciationStartDate" TIMESTAMP(3),
    "salvageValue" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "acquisitionCost" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "accumulatedDepreciation" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "netBookValue" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fixed_asset_area_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_capitalizations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" "AssetCapitalizationKind" NOT NULL,
    "number" TEXT NOT NULL,
    "seriesId" TEXT,
    "origin" "AssetCapitalizationOrigin" NOT NULL DEFAULT 'MANUAL',
    "apBillId" TEXT,
    "baseCapitalizationId" TEXT,
    "depreciationAreaId" TEXT,
    "status" "AssetCapitalizationStatus" NOT NULL DEFAULT 'POSTED',
    "reference" TEXT,
    "postingDate" TIMESTAMP(3) NOT NULL,
    "documentDate" TIMESTAMP(3) NOT NULL,
    "assetValueDate" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL,
    "total" DECIMAL(19,4) NOT NULL,
    "journalRemark" TEXT NOT NULL,
    "remarks" TEXT,
    "idempotencyKey" TEXT,
    "journalEntryId" TEXT,
    "cancellationJournalEntryId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_capitalizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_capitalization_lines" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "capitalizationId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "apBillLineId" TEXT,
    "amount" DECIMAL(19,4) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "remarks" TEXT,
    "ordering" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "asset_capitalization_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "asset_classes_companyId_assetAccountId_idx" ON "asset_classes"("companyId", "assetAccountId");

-- CreateIndex
CREATE INDEX "asset_classes_companyId_accumulatedDepreciationAccountId_idx" ON "asset_classes"("companyId", "accumulatedDepreciationAccountId");

-- CreateIndex
CREATE INDEX "asset_classes_companyId_depreciationExpenseAccountId_idx" ON "asset_classes"("companyId", "depreciationExpenseAccountId");

-- CreateIndex
CREATE INDEX "asset_classes_companyId_clearingAccountId_idx" ON "asset_classes"("companyId", "clearingAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "asset_classes_companyId_code_key" ON "asset_classes"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "asset_classes_companyId_id_key" ON "asset_classes"("companyId", "id");

-- CreateIndex
CREATE INDEX "depreciation_areas_companyId_idx" ON "depreciation_areas"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "depreciation_areas_companyId_code_key" ON "depreciation_areas"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "depreciation_areas_companyId_id_key" ON "depreciation_areas"("companyId", "id");

-- CreateIndex
CREATE INDEX "fixed_asset_area_values_companyId_assetId_idx" ON "fixed_asset_area_values"("companyId", "assetId");

-- CreateIndex
CREATE INDEX "fixed_asset_area_values_companyId_areaId_idx" ON "fixed_asset_area_values"("companyId", "areaId");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_asset_area_values_assetId_areaId_key" ON "fixed_asset_area_values"("assetId", "areaId");

-- CreateIndex
CREATE INDEX "asset_capitalizations_companyId_kind_status_idx" ON "asset_capitalizations"("companyId", "kind", "status");

-- CreateIndex
CREATE INDEX "asset_capitalizations_companyId_apBillId_idx" ON "asset_capitalizations"("companyId", "apBillId");

-- CreateIndex
CREATE INDEX "asset_capitalizations_companyId_baseCapitalizationId_idx" ON "asset_capitalizations"("companyId", "baseCapitalizationId");

-- CreateIndex
CREATE INDEX "asset_capitalizations_companyId_depreciationAreaId_idx" ON "asset_capitalizations"("companyId", "depreciationAreaId");

-- CreateIndex
CREATE INDEX "asset_capitalizations_companyId_seriesId_idx" ON "asset_capitalizations"("companyId", "seriesId");

-- CreateIndex
CREATE UNIQUE INDEX "asset_capitalizations_companyId_kind_number_key" ON "asset_capitalizations"("companyId", "kind", "number");

-- CreateIndex
CREATE UNIQUE INDEX "asset_capitalizations_companyId_id_key" ON "asset_capitalizations"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "asset_capitalizations_companyId_idempotencyKey_key" ON "asset_capitalizations"("companyId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "asset_capitalizations_companyId_journalEntryId_key" ON "asset_capitalizations"("companyId", "journalEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "asset_capitalizations_companyId_cancellationJournalEntryId_key" ON "asset_capitalizations"("companyId", "cancellationJournalEntryId");

-- CreateIndex
CREATE INDEX "asset_capitalization_lines_companyId_capitalizationId_idx" ON "asset_capitalization_lines"("companyId", "capitalizationId");

-- CreateIndex
CREATE INDEX "asset_capitalization_lines_companyId_assetId_idx" ON "asset_capitalization_lines"("companyId", "assetId");

-- CreateIndex
CREATE INDEX "asset_capitalization_lines_companyId_apBillLineId_idx" ON "asset_capitalization_lines"("companyId", "apBillLineId");

-- CreateIndex
CREATE UNIQUE INDEX "asset_capitalization_lines_companyId_id_key" ON "asset_capitalization_lines"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "branches_companyId_id_key" ON "branches"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "employees_companyId_id_key" ON "employees"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ap_bill_lines_companyId_id_key" ON "ap_bill_lines"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "numbering_series_companyId_id_key" ON "numbering_series"("companyId", "id");

-- CreateIndex
CREATE INDEX "fixed_assets_companyId_assetClassId_idx" ON "fixed_assets"("companyId", "assetClassId");

-- CreateIndex
CREATE INDEX "fixed_assets_companyId_vendorId_vendorCardType_idx" ON "fixed_assets"("companyId", "vendorId", "vendorCardType");

-- CreateIndex
CREATE INDEX "fixed_assets_companyId_branchId_idx" ON "fixed_assets"("companyId", "branchId");

-- CreateIndex
CREATE INDEX "fixed_assets_companyId_employeeId_idx" ON "fixed_assets"("companyId", "employeeId");

-- CreateIndex
CREATE INDEX "fixed_assets_companyId_technicianId_idx" ON "fixed_assets"("companyId", "technicianId");

-- CreateIndex
CREATE INDEX "fixed_assets_companyId_costCenterId_idx" ON "fixed_assets"("companyId", "costCenterId");

-- CreateIndex
CREATE INDEX "fixed_assets_companyId_projectId_idx" ON "fixed_assets"("companyId", "projectId");

-- CreateIndex
CREATE INDEX "fixed_assets_companyId_distributionRuleId_idx" ON "fixed_assets"("companyId", "distributionRuleId");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_assets_companyId_id_key" ON "fixed_assets"("companyId", "id");

-- CreateIndex
CREATE INDEX "fixed_asset_transactions_companyId_assetId_postingDate_idx" ON "fixed_asset_transactions"("companyId", "assetId", "postingDate");

-- CreateIndex
CREATE INDEX "fixed_asset_transactions_companyId_areaId_idx" ON "fixed_asset_transactions"("companyId", "areaId");

-- CreateIndex
CREATE INDEX "fixed_asset_transactions_companyId_journalEntryId_idx" ON "fixed_asset_transactions"("companyId", "journalEntryId");

-- CreateIndex
CREATE INDEX "fixed_asset_transactions_companyId_capitalizationId_idx" ON "fixed_asset_transactions"("companyId", "capitalizationId");

-- CreateIndex
CREATE INDEX "fixed_asset_transactions_companyId_capitalizationLineId_idx" ON "fixed_asset_transactions"("companyId", "capitalizationLineId");

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_companyId_assetClassId_fkey" FOREIGN KEY ("companyId", "assetClassId") REFERENCES "asset_classes"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_companyId_vendorId_vendorCardType_fkey" FOREIGN KEY ("companyId", "vendorId", "vendorCardType") REFERENCES "business_partners"("companyId", "id", "cardType") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_companyId_branchId_fkey" FOREIGN KEY ("companyId", "branchId") REFERENCES "branches"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_companyId_employeeId_fkey" FOREIGN KEY ("companyId", "employeeId") REFERENCES "employees"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_companyId_technicianId_fkey" FOREIGN KEY ("companyId", "technicianId") REFERENCES "employees"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_companyId_costCenterId_fkey" FOREIGN KEY ("companyId", "costCenterId") REFERENCES "cost_centers"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_companyId_projectId_fkey" FOREIGN KEY ("companyId", "projectId") REFERENCES "finance_projects"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_companyId_distributionRuleId_fkey" FOREIGN KEY ("companyId", "distributionRuleId") REFERENCES "distribution_rules"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_classes" ADD CONSTRAINT "asset_classes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_classes" ADD CONSTRAINT "asset_classes_companyId_assetAccountId_fkey" FOREIGN KEY ("companyId", "assetAccountId") REFERENCES "accounts"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_classes" ADD CONSTRAINT "asset_classes_companyId_accumulatedDepreciationAccountId_fkey" FOREIGN KEY ("companyId", "accumulatedDepreciationAccountId") REFERENCES "accounts"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_classes" ADD CONSTRAINT "asset_classes_companyId_depreciationExpenseAccountId_fkey" FOREIGN KEY ("companyId", "depreciationExpenseAccountId") REFERENCES "accounts"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_classes" ADD CONSTRAINT "asset_classes_companyId_clearingAccountId_fkey" FOREIGN KEY ("companyId", "clearingAccountId") REFERENCES "accounts"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "depreciation_areas" ADD CONSTRAINT "depreciation_areas_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_area_values" ADD CONSTRAINT "fixed_asset_area_values_companyId_assetId_fkey" FOREIGN KEY ("companyId", "assetId") REFERENCES "fixed_assets"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_area_values" ADD CONSTRAINT "fixed_asset_area_values_companyId_areaId_fkey" FOREIGN KEY ("companyId", "areaId") REFERENCES "depreciation_areas"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_transactions" ADD CONSTRAINT "fixed_asset_transactions_companyId_assetId_fkey" FOREIGN KEY ("companyId", "assetId") REFERENCES "fixed_assets"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_transactions" ADD CONSTRAINT "fixed_asset_transactions_companyId_areaId_fkey" FOREIGN KEY ("companyId", "areaId") REFERENCES "depreciation_areas"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_transactions" ADD CONSTRAINT "fixed_asset_transactions_companyId_journalEntryId_fkey" FOREIGN KEY ("companyId", "journalEntryId") REFERENCES "journal_entries"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_transactions" ADD CONSTRAINT "fixed_asset_transactions_companyId_capitalizationId_fkey" FOREIGN KEY ("companyId", "capitalizationId") REFERENCES "asset_capitalizations"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_transactions" ADD CONSTRAINT "fixed_asset_transactions_companyId_capitalizationLineId_fkey" FOREIGN KEY ("companyId", "capitalizationLineId") REFERENCES "asset_capitalization_lines"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_capitalizations" ADD CONSTRAINT "asset_capitalizations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_capitalizations" ADD CONSTRAINT "asset_capitalizations_companyId_seriesId_fkey" FOREIGN KEY ("companyId", "seriesId") REFERENCES "numbering_series"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_capitalizations" ADD CONSTRAINT "asset_capitalizations_companyId_apBillId_fkey" FOREIGN KEY ("companyId", "apBillId") REFERENCES "ap_bills"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_capitalizations" ADD CONSTRAINT "asset_capitalizations_companyId_baseCapitalizationId_fkey" FOREIGN KEY ("companyId", "baseCapitalizationId") REFERENCES "asset_capitalizations"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_capitalizations" ADD CONSTRAINT "asset_capitalizations_companyId_depreciationAreaId_fkey" FOREIGN KEY ("companyId", "depreciationAreaId") REFERENCES "depreciation_areas"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_capitalizations" ADD CONSTRAINT "asset_capitalizations_companyId_currency_fkey" FOREIGN KEY ("companyId", "currency") REFERENCES "currencies"("companyId", "code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_capitalizations" ADD CONSTRAINT "asset_capitalizations_companyId_journalEntryId_fkey" FOREIGN KEY ("companyId", "journalEntryId") REFERENCES "journal_entries"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_capitalizations" ADD CONSTRAINT "asset_capitalizations_companyId_cancellationJournalEntryId_fkey" FOREIGN KEY ("companyId", "cancellationJournalEntryId") REFERENCES "journal_entries"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_capitalization_lines" ADD CONSTRAINT "asset_capitalization_lines_companyId_capitalizationId_fkey" FOREIGN KEY ("companyId", "capitalizationId") REFERENCES "asset_capitalizations"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_capitalization_lines" ADD CONSTRAINT "asset_capitalization_lines_companyId_assetId_fkey" FOREIGN KEY ("companyId", "assetId") REFERENCES "fixed_assets"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_capitalization_lines" ADD CONSTRAINT "asset_capitalization_lines_companyId_apBillLineId_fkey" FOREIGN KEY ("companyId", "apBillLineId") REFERENCES "ap_bill_lines"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─── Rules the database itself holds ─────────────────────────────────────────
ALTER TABLE "fixed_assets"
  ADD CONSTRAINT "fixed_assets_quantity_nonnegative" CHECK ("quantity" >= 0),
  ADD CONSTRAINT "fixed_assets_purchase_cost_nonnegative" CHECK ("purchaseCost" IS NULL OR "purchaseCost" >= 0),
  -- The preferred vendor is a VENDOR: the card type is part of the foreign
  -- key onto business_partners(companyId, id, cardType), and held here.
  ADD CONSTRAINT "fixed_assets_vendor_is_vendor"
    CHECK (("vendorId" IS NULL AND "vendorCardType" IS NULL) OR ("vendorId" IS NOT NULL AND "vendorCardType" = 'VENDOR'));

ALTER TABLE "asset_classes" ADD CONSTRAINT "asset_classes_useful_life_range" CHECK ("usefulLifeMonths" BETWEEN 1 AND 1200);

ALTER TABLE "fixed_asset_area_values"
  ADD CONSTRAINT "fixed_asset_area_values_amounts_nonnegative"
    CHECK ("acquisitionCost" >= 0 AND "accumulatedDepreciation" >= 0 AND "salvageValue" >= 0),
  ADD CONSTRAINT "fixed_asset_area_values_nbv_is_apc_less_depreciation"
    CHECK ("netBookValue" = "acquisitionCost" - "accumulatedDepreciation"),
  ADD CONSTRAINT "fixed_asset_area_values_useful_life_range" CHECK ("usefulLifeMonths" BETWEEN 1 AND 1200);

-- One active depreciation area per company posts to the G/L. Two would book
-- every capitalization and every month's depreciation twice.
CREATE UNIQUE INDEX "depreciation_areas_one_posting_area_per_company"
  ON "depreciation_areas" ("companyId") WHERE "postsToGl" AND "isActive";

ALTER TABLE "asset_capitalizations"
  ADD CONSTRAINT "asset_capitalizations_total_positive" CHECK ("total" > 0),
  ADD CONSTRAINT "asset_capitalizations_ap_origin_has_bill" CHECK ("origin" <> 'AP_INVOICE' OR "apBillId" IS NOT NULL),
  ADD CONSTRAINT "asset_capitalizations_manual_has_no_bill" CHECK ("origin" <> 'MANUAL' OR "apBillId" IS NULL),
  ADD CONSTRAINT "asset_capitalizations_base_only_on_credit_memo" CHECK ("baseCapitalizationId" IS NULL OR "kind" = 'CREDIT_MEMO'),
  ADD CONSTRAINT "asset_capitalizations_cancelled_has_date" CHECK ("status" <> 'CANCELLED' OR "cancelledAt" IS NOT NULL);

-- Amounts: more than zero, at most 999,999,999,999,999.99 (QA FA-D13).
ALTER TABLE "asset_capitalization_lines"
  ADD CONSTRAINT "asset_capitalization_lines_amount_range" CHECK ("amount" > 0 AND "amount" <= 999999999999999.99),
  ADD CONSTRAINT "asset_capitalization_lines_quantity_nonnegative" CHECK ("quantity" >= 0);

-- One journal entry per document: the document's own unique link is the
-- first guard, this the second (reversals carry source 'reversal').
CREATE UNIQUE INDEX "journal_entries_one_per_fixed_asset_document"
  ON "journal_entries" ("companyId", "source", "sourceId")
  WHERE "source" IN ('fixed_asset_capitalization', 'fixed_asset_credit_memo');

-- A posted document is history. Its lines never change, it is never deleted,
-- and the only changes the header accepts are the journal links being filled
-- in and POSTED → CANCELLED. Refusals carry ERP_RULE so the API answers 409.
CREATE OR REPLACE FUNCTION erp_asset_capitalization_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ERP_RULE: Capitalization document % is posted and cannot be deleted. Cancel it instead.', OLD."number"
      USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW."companyId", NEW."kind", NEW."number", NEW."seriesId", NEW."origin", NEW."apBillId", NEW."baseCapitalizationId",
      NEW."depreciationAreaId", NEW."reference", NEW."postingDate", NEW."documentDate", NEW."assetValueDate",
      NEW."currency", NEW."total", NEW."journalRemark", NEW."remarks", NEW."idempotencyKey", NEW."createdById")
     IS DISTINCT FROM
     (OLD."companyId", OLD."kind", OLD."number", OLD."seriesId", OLD."origin", OLD."apBillId", OLD."baseCapitalizationId",
      OLD."depreciationAreaId", OLD."reference", OLD."postingDate", OLD."documentDate", OLD."assetValueDate",
      OLD."currency", OLD."total", OLD."journalRemark", OLD."remarks", OLD."idempotencyKey", OLD."createdById") THEN
    RAISE EXCEPTION 'ERP_RULE: Capitalization document % is posted and cannot be changed. Cancel it and post a new one.', OLD."number"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."journalEntryId" IS NOT NULL AND NEW."journalEntryId" IS DISTINCT FROM OLD."journalEntryId" THEN
    RAISE EXCEPTION 'ERP_RULE: The journal entry of capitalization document % cannot be replaced.', OLD."number"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" = 'CANCELLED' AND (NEW."status" <> 'CANCELLED'
      OR NEW."cancellationJournalEntryId" IS DISTINCT FROM OLD."cancellationJournalEntryId"
      OR NEW."cancelledAt" IS DISTINCT FROM OLD."cancelledAt") THEN
    RAISE EXCEPTION 'ERP_RULE: Capitalization document % is cancelled; a cancelled document stays cancelled.', OLD."number"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER asset_capitalization_guard
  BEFORE UPDATE OR DELETE ON "asset_capitalizations"
  FOR EACH ROW EXECUTE FUNCTION erp_asset_capitalization_guard();

CREATE OR REPLACE FUNCTION erp_asset_capitalization_line_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ERP_RULE: The lines of a posted capitalization document cannot be changed or deleted. Cancel the document instead.'
    USING ERRCODE = 'check_violation';
END $$ LANGUAGE plpgsql;

CREATE TRIGGER asset_capitalization_line_guard
  BEFORE UPDATE OR DELETE ON "asset_capitalization_lines"
  FOR EACH ROW EXECUTE FUNCTION erp_asset_capitalization_line_guard();

-- The asset history is append-only: what happened stays, a correction is a
-- new, offsetting row.
CREATE OR REPLACE FUNCTION erp_fixed_asset_transaction_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ERP_RULE: Asset history cannot be changed or deleted; corrections are new, offsetting movements.'
    USING ERRCODE = 'check_violation';
END $$ LANGUAGE plpgsql;

CREATE TRIGGER fixed_asset_transaction_guard
  BEFORE UPDATE OR DELETE ON "fixed_asset_transactions"
  FOR EACH ROW EXECUTE FUNCTION erp_fixed_asset_transaction_guard();

-- ─── Defaults ────────────────────────────────────────────────────────────────
-- Only what needs no accounting judgement: the MAIN depreciation area (posts
-- to the G/L) and the numbering series. Asset classes and their accounts are
-- set up by the company's accountant under Asset Classes (QA FA-D4): the two
-- chart-of-accounts layouts differ, and guessed accounts would be worse than
-- none. Returns one log line per thing created or kept; idempotent.
CREATE OR REPLACE FUNCTION erp_apply_fixed_asset_defaults(p_company TEXT)
RETURNS SETOF TEXT AS $$
DECLARE
  n INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "depreciation_areas" WHERE "companyId" = p_company) THEN
    INSERT INTO "depreciation_areas" ("id", "companyId", "code", "name", "postsToGl", "ordering", "isActive", "updatedAt")
    VALUES (gen_random_uuid()::TEXT, p_company, 'MAIN', 'Main Area', true, 1, true, now());
    RETURN NEXT 'created depreciation area MAIN (posts to G/L)';
  ELSE
    RETURN NEXT 'kept existing depreciation areas';
  END IF;

  INSERT INTO "numbering_series" ("id", "companyId", "documentType", "name", "prefix", "firstNumber", "nextNumber", "digits", "isDefault", "updatedAt")
  SELECT gen_random_uuid()::TEXT, p_company, v.doc, 'Primary', v.prefix, 1, 1, 5, true, now()
  FROM (VALUES ('fixed_asset', 'FA-'), ('fixed_asset_capitalization', 'CAP-'),
               ('fixed_asset_credit_memo', 'CAPCM-')) v(doc, prefix)
  WHERE NOT EXISTS (SELECT 1 FROM "numbering_series" s WHERE s."companyId" = p_company AND s."documentType" = v.doc);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN NEXT CASE WHEN n > 0 THEN 'created ' || n || ' numbering series (FA- / CAP- / CAPCM-)' ELSE 'kept existing numbering series' END;
END $$ LANGUAGE plpgsql;

DO $$
DECLARE
  co RECORD;
  line TEXT;
BEGIN
  FOR co IN SELECT "id", "name" FROM "companies" ORDER BY "createdAt" LOOP
    FOR line IN SELECT erp_apply_fixed_asset_defaults(co."id") LOOP
      RAISE NOTICE '[fixed asset defaults] % : %', co."name", line;
    END LOOP;
  END LOOP;
END $$;

-- ─── Permissions (QA FA-D14) ─────────────────────────────────────────────────
-- The catalog (permission-catalog.ts) is normally loaded by `prisma seed`;
-- these rows are put in place here so the routes are usable the moment this
-- deploys. ON CONFLICT DO NOTHING on every insert.
INSERT INTO "permissions" ("id", "key", "resource", "action", "moduleSlug", "description")
SELECT gen_random_uuid()::TEXT, v.key, v.resource, v.action, 'financials', v.description
FROM (VALUES
  ('financials.fixed_asset.view',             'financials.fixed_asset',          'view',       'View fixed assets'),
  ('financials.fixed_asset.create',           'financials.fixed_asset',          'create',     'Create fixed assets'),
  ('financials.fixed_asset.update',           'financials.fixed_asset',          'update',     'Update fixed assets'),
  ('financials.fixed_asset.delete',           'financials.fixed_asset',          'delete',     'Delete fixed assets'),
  ('financials.fixed_asset.manage',           'financials.fixed_asset',          'manage',     'Manage fixed assets'),
  ('financials.fixed_asset.depreciate',       'financials.fixed_asset',          'depreciate', 'Run depreciation and post it to the G/L'),
  ('financials.asset_class.view',             'financials.asset_class',          'view',       'View asset classes'),
  ('financials.asset_class.create',           'financials.asset_class',          'create',     'Create asset classes'),
  ('financials.asset_class.update',           'financials.asset_class',          'update',     'Update asset classes'),
  ('financials.asset_class.delete',           'financials.asset_class',          'delete',     'Delete asset classes'),
  ('financials.asset_class.manage',           'financials.asset_class',          'manage',     'Manage asset classes'),
  ('financials.depreciation_area.view',       'financials.depreciation_area',    'view',       'View depreciation areas'),
  ('financials.depreciation_area.create',     'financials.depreciation_area',    'create',     'Create depreciation areas'),
  ('financials.depreciation_area.update',     'financials.depreciation_area',    'update',     'Update depreciation areas'),
  ('financials.depreciation_area.delete',     'financials.depreciation_area',    'delete',     'Delete depreciation areas'),
  ('financials.depreciation_area.manage',     'financials.depreciation_area',    'manage',     'Manage depreciation areas'),
  ('financials.fixed_asset_document.view',    'financials.fixed_asset_document', 'view',       'View capitalizations and capitalization credit memos'),
  ('financials.fixed_asset_document.create',  'financials.fixed_asset_document', 'create',     'Post capitalizations and capitalization credit memos to the G/L'),
  ('financials.fixed_asset_document.cancel',  'financials.fixed_asset_document', 'cancel',     'Cancel a capitalization or credit memo (reverses its journal entry)')
) v(key, resource, action, description)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "permission_sets" ("id", "key", "name", "description", "isSystem", "companyId", "updatedAt")
VALUES (gen_random_uuid()::TEXT, 'financials.fixed_assets', 'Financials — Fixed Assets',
        'Asset master data, asset classes, depreciation areas, capitalization and capitalization credit memos, depreciation.',
        true, NULL, now())
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "permission_set_items" ("id", "setId", "permissionId", "scope")
SELECT gen_random_uuid()::TEXT, s."id", p."id", 'ALL'
FROM "permission_sets" s
JOIN "permissions" p ON p."key" LIKE 'financials.fixed\_asset.%'
                     OR p."key" LIKE 'financials.asset\_class.%'
                     OR p."key" LIKE 'financials.depreciation\_area.%'
                     OR p."key" LIKE 'financials.fixed\_asset\_document.%'
WHERE s."key" = 'financials.fixed_assets'
ON CONFLICT ("setId", "permissionId", "scope") DO NOTHING;

-- The Accountant posts: views the register and its setup, posts and cancels
-- capitalization documents, runs depreciation. Maintaining assets and classes
-- stays with the Fixed Assets set.
INSERT INTO "permission_set_items" ("id", "setId", "permissionId", "scope")
SELECT gen_random_uuid()::TEXT, s."id", p."id", 'ALL'
FROM "permission_sets" s
JOIN "permissions" p ON p."key" IN ('financials.fixed_asset.view', 'financials.asset_class.view',
                                     'financials.depreciation_area.view', 'financials.fixed_asset_document.view',
                                     'financials.fixed_asset_document.create', 'financials.fixed_asset_document.cancel',
                                     'financials.fixed_asset.depreciate')
WHERE s."key" = 'financials.accountant'
ON CONFLICT ("setId", "permissionId", "scope") DO NOTHING;

-- Every company's admin role ("Company Admin" from the onboarding template,
-- "Admin" in the original demo company) gets the full set.
DO $$
DECLARE
  set_id TEXT;
  r RECORD;
  n INT;
BEGIN
  SELECT "id" INTO set_id FROM "permission_sets" WHERE "key" = 'financials.fixed_assets';
  FOR r IN
    SELECT ro."id", ro."name", c."name" AS company FROM "roles" ro JOIN "companies" c ON c."id" = ro."companyId"
    WHERE ro."name" IN ('Company Admin', 'Admin') ORDER BY c."createdAt"
  LOOP
    INSERT INTO "role_permission_sets" ("roleId", "setId") VALUES (r."id", set_id) ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE '[fixed asset permissions] % : role % %', r.company, r."name",
      CASE WHEN n > 0 THEN 'given financials.fixed_assets' ELSE 'already has financials.fixed_assets' END;
  END LOOP;
END $$;

-- ─── Companies that get their Financials foundation later ────────────────────
-- erp_bootstrap_financials (20260926020000) builds the foundation for a
-- company that has none; it now applies the fixed asset defaults as its last
-- step. Unchanged otherwise.
CREATE OR REPLACE FUNCTION erp_bootstrap_financials(p_company TEXT, p_year INT DEFAULT NULL)
RETURNS SETOF TEXT AS $$
DECLARE
  yr INT := COALESCE(p_year, EXTRACT(YEAR FROM now())::INT);
  fy_start INT;
  cur TEXT;
  parent_id TEXT;
  y_from DATE;
  y_to DATE;
  i INT;
  line TEXT;
BEGIN
  INSERT INTO "currencies" ("id", "companyId", "code", "name", "hundredthName", "decimals")
  SELECT gen_random_uuid()::TEXT, p_company, v.code, v.name, v.hund, 2
  FROM (VALUES ('USD', 'US Dollar', 'Cents'), ('EUR', 'Euro', 'Cents'), ('GBP', 'British Pound', 'Pence'),
               ('PKR', 'Pakistani Rupee', 'Paisa')) v(code, name, hund)
  WHERE NOT EXISTS (SELECT 1 FROM "currencies" c WHERE c."companyId" = p_company AND c."code" = v.code);
  IF FOUND THEN RETURN NEXT 'created currency master (USD, EUR, GBP, PKR where missing)'; END IF;

  -- The company's own currency, if it is not one of the four above.
  INSERT INTO "currencies" ("id", "companyId", "code", "name", "decimals")
  SELECT gen_random_uuid()::TEXT, c."id", c."currency", c."currency", 2 FROM "companies" c
  WHERE c."id" = p_company AND c."currency" IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM "currencies" x WHERE x."companyId" = c."id" AND x."code" = c."currency");
  IF FOUND THEN RETURN NEXT 'created currency for the company base currency'; END IF;

  cur := erp_company_account_currency(p_company);

  IF NOT EXISTS (SELECT 1 FROM "accounts" WHERE "companyId" = p_company) THEN
    INSERT INTO "accounts" ("id", "companyId", "code", "name", "type", "currency", "isTitle", "level", "updatedAt")
    SELECT gen_random_uuid()::TEXT, p_company, v.code, v.name, v.type::"AccountType", cur, true, 1, now()
    FROM (VALUES ('1000', 'Assets', 'ASSET'), ('2000', 'Liabilities', 'LIABILITY'), ('3000', 'Equity', 'EQUITY'),
                 ('4000', 'Income', 'INCOME'), ('5000', 'Expenses', 'EXPENSE')) v(code, name, type);
    INSERT INTO "accounts" ("id", "companyId", "code", "name", "type", "subtype", "isControl", "parentId", "currency", "level", "updatedAt")
    SELECT gen_random_uuid()::TEXT, p_company, v.code, v.name, v.type::"AccountType", v.subtype::"AccountSubtype", v.ctl,
      (SELECT a."id" FROM "accounts" a WHERE a."companyId" = p_company AND a."code" = v.parent), cur, 2, now()
    FROM (VALUES
      ('1010', 'Cash on Hand', 'ASSET', 'CASH', false, '1000'),
      ('1020', 'Bank Account', 'ASSET', 'BANK', false, '1000'),
      ('1200', 'Accounts Receivable', 'ASSET', 'ACCOUNTS_RECEIVABLE', true, '1000'),
      ('2100', 'Accounts Payable', 'LIABILITY', 'ACCOUNTS_PAYABLE', true, '2000'),
      ('2200', 'Tax Payable', 'LIABILITY', 'TAX_PAYABLE', false, '2000'),
      ('3100', 'Share Capital', 'EQUITY', 'SHARE_CAPITAL', false, '3000'),
      ('3900', 'Retained Earnings', 'EQUITY', 'RETAINED_EARNINGS', false, '3000'),
      ('4100', 'Sales Revenue', 'INCOME', 'REVENUE', false, '4000'),
      ('5100', 'Cost of Goods Sold', 'EXPENSE', 'COST_OF_GOODS_SOLD', false, '5000'),
      ('5200', 'Operating Expenses', 'EXPENSE', 'OPERATING_EXPENSE', false, '5000')) v(code, name, type, subtype, ctl, parent);
    UPDATE "companies" c SET
      "defaultArAccountId"         = COALESCE(c."defaultArAccountId",         (SELECT a."id" FROM "accounts" a WHERE a."companyId" = c."id" AND a."code" = '1200')),
      "defaultApAccountId"         = COALESCE(c."defaultApAccountId",         (SELECT a."id" FROM "accounts" a WHERE a."companyId" = c."id" AND a."code" = '2100')),
      "defaultCashAccountId"       = COALESCE(c."defaultCashAccountId",       (SELECT a."id" FROM "accounts" a WHERE a."companyId" = c."id" AND a."code" = '1010')),
      "defaultTaxPayableAccountId" = COALESCE(c."defaultTaxPayableAccountId", (SELECT a."id" FROM "accounts" a WHERE a."companyId" = c."id" AND a."code" = '2200')),
      "defaultRevenueAccountId"    = COALESCE(c."defaultRevenueAccountId",    (SELECT a."id" FROM "accounts" a WHERE a."companyId" = c."id" AND a."code" = '4100')),
      "defaultExpenseAccountId"    = COALESCE(c."defaultExpenseAccountId",    (SELECT a."id" FROM "accounts" a WHERE a."companyId" = c."id" AND a."code" = '5200')),
      "updatedAt" = now()
    WHERE c."id" = p_company;
    RETURN NEXT 'created hierarchical chart of accounts (15 accounts) and default control accounts';
  END IF;

  -- One fiscal year with twelve monthly periods, all Open — mirrors
  -- DemoDataSeederService.seedPostingPeriods / FiscalPeriodsService.generate.
  IF NOT EXISTS (SELECT 1 FROM "fiscal_periods" WHERE "companyId" = p_company AND "name" = yr::TEXT) THEN
    SELECT COALESCE("fiscalYearStart", 1) INTO fy_start FROM "companies" WHERE "id" = p_company;
    y_from := make_date(yr, fy_start, 1);
    y_to := (y_from + INTERVAL '1 year' - INTERVAL '1 day')::DATE;
    parent_id := gen_random_uuid()::TEXT;
    INSERT INTO "fiscal_periods" ("id", "companyId", "name", "displayName", "fiscalYear", "subPeriodType",
      "startDate", "endDate", "activeFrom", "activeTo", "updatedAt")
    VALUES (parent_id, p_company, yr::TEXT, 'Fiscal Year ' || yr, yr, 'YEAR', y_from, y_to, y_from, y_to, now());
    FOR i IN 0..11 LOOP
      INSERT INTO "fiscal_periods" ("id", "companyId", "parentId", "name", "displayName", "fiscalYear", "subPeriodType",
        "startDate", "endDate", "activeFrom", "activeTo", "dueDateFrom", "dueDateTo", "updatedAt")
      SELECT gen_random_uuid()::TEXT, p_company, parent_id, yr || '-' || lpad((i + 1)::TEXT, 2, '0'),
        to_char(s, 'FMMonth YYYY'), yr, 'MONTHS', s, e, s, e, s, e, now()
      FROM (SELECT (y_from + make_interval(months => i))::DATE AS s,
                   (y_from + make_interval(months => i + 1) - INTERVAL '1 day')::DATE AS e) x;
    END LOOP;
    RETURN NEXT format('created fiscal year %s with 12 open monthly posting periods', yr);
  END IF;

  INSERT INTO "numbering_series" ("id", "companyId", "documentType", "name", "prefix", "firstNumber", "nextNumber", "digits", "isDefault", "updatedAt")
  SELECT gen_random_uuid()::TEXT, p_company, v.doc, 'Primary', v.prefix, 1, 1, 5, true, now()
  FROM (VALUES ('journal_entry', 'JE-'), ('ar_invoice', 'INV-'), ('ap_bill', 'BILL-'), ('sales_order', 'SO-'),
               ('purchase_order', 'PO-'), ('delivery', 'DL-'), ('incoming_payment', 'RCPT-'),
               ('outgoing_payment', 'PAY-')) v(doc, prefix)
  WHERE NOT EXISTS (SELECT 1 FROM "numbering_series" n WHERE n."companyId" = p_company AND n."documentType" = v.doc);
  IF FOUND THEN RETURN NEXT 'created numbering series where missing (journal_entry, ar_invoice, …)'; END IF;

  FOR line IN SELECT erp_apply_payroll_defaults(p_company, yr) LOOP
    RETURN NEXT line;
  END LOOP;

  -- Fixed assets (20261009010000): the MAIN depreciation area and the
  -- fixed asset numbering series come with the rest of the foundation.
  FOR line IN SELECT erp_apply_fixed_asset_defaults(p_company) LOOP
    RETURN NEXT line;
  END LOOP;
END $$ LANGUAGE plpgsql;
