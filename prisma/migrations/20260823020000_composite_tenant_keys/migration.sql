-- ============================================================================
-- F6 — Composite tenant-scoped foreign keys
--
-- Every foreign key targeted a bare `id`, so nothing in the database stopped
-- company A's invoice referencing company B's order, or a journal line
-- pointing at another tenant's account. Application code was the only guard,
-- and one missed filter in one endpoint was enough.
--
-- This is cross-tenant financial contamination: silent, it corrupts reports
-- for both tenants, and it is very hard to detect after the fact.
--
-- Parents gain UNIQUE (companyId, id); cross-module children reference that
-- pair instead of the bare id, so "same tenant" becomes a database guarantee
-- along the whole money chain:
--
--   orders -> business_partners
--   ar_invoices -> business_partners, orders
--   ar_payments -> ar_invoices
--   ap_bills -> business_partners
--   ap_payments -> ap_bills
--   journal_entries -> fiscal_periods
--
-- Nullable composite keys use MATCH SIMPLE, so a row with a NULL orderId still
-- satisfies the constraint — optional links stay optional.
-- ============================================================================

-- DropForeignKey
ALTER TABLE "ap_bills" DROP CONSTRAINT "ap_bills_bpId_fkey";

-- DropForeignKey
ALTER TABLE "ap_payments" DROP CONSTRAINT "ap_payments_billId_fkey";

-- DropForeignKey
ALTER TABLE "ar_invoices" DROP CONSTRAINT "ar_invoices_bpId_fkey";

-- DropForeignKey
ALTER TABLE "ar_invoices" DROP CONSTRAINT "ar_invoices_orderId_fkey";

-- DropForeignKey
ALTER TABLE "ar_payments" DROP CONSTRAINT "ar_payments_invoiceId_fkey";

-- DropForeignKey
ALTER TABLE "journal_entries" DROP CONSTRAINT "journal_entries_periodId_fkey";

-- DropForeignKey
ALTER TABLE "orders" DROP CONSTRAINT "orders_bpId_fkey";

-- CreateIndex
CREATE UNIQUE INDEX "accounts_companyId_id_key" ON "accounts"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ap_bills_companyId_id_key" ON "ap_bills"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ar_invoices_companyId_id_key" ON "ar_invoices"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "business_partners_companyId_id_key" ON "business_partners"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_periods_companyId_id_key" ON "fiscal_periods"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_companyId_id_key" ON "orders"("companyId", "id");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_companyId_bpId_fkey" FOREIGN KEY ("companyId", "bpId") REFERENCES "business_partners"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_companyId_periodId_fkey" FOREIGN KEY ("companyId", "periodId") REFERENCES "fiscal_periods"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_invoices" ADD CONSTRAINT "ar_invoices_companyId_bpId_fkey" FOREIGN KEY ("companyId", "bpId") REFERENCES "business_partners"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_invoices" ADD CONSTRAINT "ar_invoices_companyId_orderId_fkey" FOREIGN KEY ("companyId", "orderId") REFERENCES "orders"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_payments" ADD CONSTRAINT "ar_payments_companyId_invoiceId_fkey" FOREIGN KEY ("companyId", "invoiceId") REFERENCES "ar_invoices"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_bills" ADD CONSTRAINT "ap_bills_companyId_bpId_fkey" FOREIGN KEY ("companyId", "bpId") REFERENCES "business_partners"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_payments" ADD CONSTRAINT "ap_payments_companyId_billId_fkey" FOREIGN KEY ("companyId", "billId") REFERENCES "ap_bills"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

