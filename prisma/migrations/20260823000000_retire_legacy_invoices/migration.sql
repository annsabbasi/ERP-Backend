-- ============================================================================
-- F4 — Retire the legacy invoice tables
--
-- Two parallel receivable systems existed and `orders` was related to BOTH:
--
--   invoices / invoice_lines   bare Decimal total, no payment terms, no
--                              payments, no journal entry
--   ar_invoices / ar_invoice_lines  the real one, wired to the ledger
--
-- Nothing declared which was authoritative, so revenue had two possible
-- answers and every new foreign key doubled the ambiguity.
--
-- ar_invoices wins: it is the one that posts to the general ledger. The legacy
-- pair held 0 rows, so no data migration is required — verified before running.
-- The /api/v1/invoices module and its frontend client are removed in the same
-- change; no window referenced them.
-- ============================================================================

-- DropForeignKey
ALTER TABLE "invoice_lines" DROP CONSTRAINT "invoice_lines_invoiceId_fkey";

-- DropForeignKey
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_companyId_fkey";

-- DropForeignKey
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_orderId_fkey";

-- DropTable
DROP TABLE "invoice_lines";

-- DropTable
DROP TABLE "invoices";

-- DropEnum
DROP TYPE "InvoiceStatus";

