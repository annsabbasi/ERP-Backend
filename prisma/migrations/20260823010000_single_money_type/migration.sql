-- ============================================================================
-- F5 — One money representation
--
-- Money was stored three incompatible ways along the exact chain being linked:
--
--   products.price, orders.total        Decimal(12,2)
--   ar_invoices.totalMinor et al        Int   (32-bit minor units)
--   journal_entries.totalDebit          Decimal(15,2)
--
-- So order -> invoice -> ledger crossed representations twice, and the 32-bit
-- integer capped a two-decimal amount at 21,474,836.47 — a plausible single
-- B2B invoice. Past that you do not get a rounding error, you get a failed
-- insert.
--
-- Everything monetary is now Decimal(19,4): it matches the ledger's existing
-- type family, removes both conversion points, and holds four-decimal unit
-- prices. Percentages, ratios and FX rates keep their own precision and are
-- deliberately untouched.
--
-- The `Minor` suffix is dropped with the type — leaving it on a major-unit
-- column would be worse than the original inconsistency.
--
-- Prisma emits DROP COLUMN + ADD COLUMN rather than a rename here. Every
-- affected table was verified empty immediately before this migration was
-- written, so no value is discarded. Do NOT replay this against a database
-- that has invoice or payroll rows without converting it to RENAME first.
-- ============================================================================

-- Views read these columns, so Postgres refuses the type change while they
-- exist. Prisma does not manage views (F14), so they are dropped and rebuilt
-- here by hand.
DROP VIEW IF EXISTS v_order_to_cash;
DROP VIEW IF EXISTS v_customer_summary;
DROP VIEW IF EXISTS v_gl_account_balances;
DROP VIEW IF EXISTS v_procure_to_pay;

-- AlterTable
ALTER TABLE "ap_bill_lines" DROP COLUMN "lineTotalMinor",
DROP COLUMN "taxMinor",
DROP COLUMN "unitPriceMinor",
ADD COLUMN     "lineTotal" DECIMAL(19,4) NOT NULL,
ADD COLUMN     "tax" DECIMAL(19,4) NOT NULL DEFAULT 0,
ADD COLUMN     "unitPrice" DECIMAL(19,4) NOT NULL,
ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(19,4);

-- AlterTable
ALTER TABLE "ap_bills" DROP COLUMN "paidMinor",
DROP COLUMN "subtotalMinor",
DROP COLUMN "taxMinor",
DROP COLUMN "totalMinor",
ADD COLUMN     "paid" DECIMAL(19,4) NOT NULL DEFAULT 0,
ADD COLUMN     "subtotal" DECIMAL(19,4) NOT NULL DEFAULT 0,
ADD COLUMN     "tax" DECIMAL(19,4) NOT NULL DEFAULT 0,
ADD COLUMN     "total" DECIMAL(19,4) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ap_payments" DROP COLUMN "amountMinor",
ADD COLUMN     "amount" DECIMAL(19,4) NOT NULL;

-- AlterTable
ALTER TABLE "ar_invoice_lines" DROP COLUMN "lineTotalMinor",
DROP COLUMN "taxMinor",
DROP COLUMN "unitPriceMinor",
ADD COLUMN     "lineTotal" DECIMAL(19,4) NOT NULL,
ADD COLUMN     "tax" DECIMAL(19,4) NOT NULL DEFAULT 0,
ADD COLUMN     "unitPrice" DECIMAL(19,4) NOT NULL,
ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(19,4);

-- AlterTable
ALTER TABLE "ar_invoices" DROP COLUMN "paidMinor",
DROP COLUMN "subtotalMinor",
DROP COLUMN "taxMinor",
DROP COLUMN "totalMinor",
ADD COLUMN     "paid" DECIMAL(19,4) NOT NULL DEFAULT 0,
ADD COLUMN     "subtotal" DECIMAL(19,4) NOT NULL DEFAULT 0,
ADD COLUMN     "tax" DECIMAL(19,4) NOT NULL DEFAULT 0,
ADD COLUMN     "total" DECIMAL(19,4) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ar_payments" DROP COLUMN "amountMinor",
ADD COLUMN     "amount" DECIMAL(19,4) NOT NULL;

-- AlterTable
ALTER TABLE "billing_invoices" DROP COLUMN "amountMinor",
ADD COLUMN     "amount" DECIMAL(19,4) NOT NULL;

-- AlterTable
ALTER TABLE "billing_payments" DROP COLUMN "amountMinor",
ADD COLUMN     "amount" DECIMAL(19,4) NOT NULL;

-- AlterTable
ALTER TABLE "budget_lines" ALTER COLUMN "annualDebit" SET DATA TYPE DECIMAL(19,4),
ALTER COLUMN "annualCredit" SET DATA TYPE DECIMAL(19,4);

-- AlterTable
ALTER TABLE "business_partners" ALTER COLUMN "creditLimit" SET DATA TYPE DECIMAL(19,4),
ALTER COLUMN "commitmentLimit" SET DATA TYPE DECIMAL(19,4),
ALTER COLUMN "interestOnArrears" SET DATA TYPE DECIMAL(19,4),
ALTER COLUMN "accountBalance" SET DATA TYPE DECIMAL(19,4),
ALTER COLUMN "ordersBalance" SET DATA TYPE DECIMAL(19,4),
ALTER COLUMN "deliveriesBalance" SET DATA TYPE DECIMAL(19,4),
ALTER COLUMN "opportunitiesAmount" SET DATA TYPE DECIMAL(19,4);

-- AlterTable
ALTER TABLE "campaigns" ALTER COLUMN "budgetAmount" SET DATA TYPE DECIMAL(19,4),
ALTER COLUMN "revenueAmount" SET DATA TYPE DECIMAL(19,4);

-- AlterTable
ALTER TABLE "employees" ALTER COLUMN "salary" SET DATA TYPE DECIMAL(19,4);

-- AlterTable
ALTER TABLE "employment_contracts" DROP COLUMN "salaryAmountMinor",
ADD COLUMN     "salaryAmount" DECIMAL(19,4);

-- AlterTable
ALTER TABLE "fixed_asset_transactions" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(19,4);

-- AlterTable
ALTER TABLE "fixed_assets" ALTER COLUMN "acquisitionCost" SET DATA TYPE DECIMAL(19,4),
ALTER COLUMN "salvageValue" SET DATA TYPE DECIMAL(19,4),
ALTER COLUMN "accumulatedDepreciation" SET DATA TYPE DECIMAL(19,4),
ALTER COLUMN "netBookValue" SET DATA TYPE DECIMAL(19,4);

-- AlterTable
ALTER TABLE "internal_reconciliation_lines" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(19,4);

-- AlterTable
ALTER TABLE "internal_reconciliations" ALTER COLUMN "totalAmount" SET DATA TYPE DECIMAL(19,4);

-- AlterTable
ALTER TABLE "journal_entries" ALTER COLUMN "totalDebit" SET DATA TYPE DECIMAL(19,4),
ALTER COLUMN "totalCredit" SET DATA TYPE DECIMAL(19,4);

-- AlterTable
ALTER TABLE "journal_lines" ALTER COLUMN "debit" SET DATA TYPE DECIMAL(19,4),
ALTER COLUMN "credit" SET DATA TYPE DECIMAL(19,4),
ALTER COLUMN "taxAmount" SET DATA TYPE DECIMAL(19,4);

-- AlterTable
ALTER TABLE "leave_balances" ALTER COLUMN "accruedDays" SET DATA TYPE DECIMAL(19,4),
ALTER COLUMN "usedDays" SET DATA TYPE DECIMAL(19,4),
ALTER COLUMN "pendingDays" SET DATA TYPE DECIMAL(19,4),
ALTER COLUMN "carryOverDays" SET DATA TYPE DECIMAL(19,4);

-- AlterTable
ALTER TABLE "leave_requests" ALTER COLUMN "days" SET DATA TYPE DECIMAL(19,4);

-- AlterTable
ALTER TABLE "leave_types" ALTER COLUMN "accrualDays" SET DATA TYPE DECIMAL(19,4),
ALTER COLUMN "maxBalance" SET DATA TYPE DECIMAL(19,4);

-- AlterTable
ALTER TABLE "opportunities" ALTER COLUMN "potentialAmount" SET DATA TYPE DECIMAL(19,4),
ALTER COLUMN "weightedAmount" SET DATA TYPE DECIMAL(19,4),
ALTER COLUMN "grossProfit" SET DATA TYPE DECIMAL(19,4);

-- AlterTable
ALTER TABLE "opportunity_stage_entries" ALTER COLUMN "potentialAmount" SET DATA TYPE DECIMAL(19,4),
ALTER COLUMN "weightedAmount" SET DATA TYPE DECIMAL(19,4);

-- AlterTable
ALTER TABLE "order_items" ALTER COLUMN "unitPrice" SET DATA TYPE DECIMAL(19,4);

-- AlterTable
ALTER TABLE "orders" ALTER COLUMN "total" SET DATA TYPE DECIMAL(19,4);

-- AlterTable
ALTER TABLE "plans" ALTER COLUMN "monthlyPrice" SET DATA TYPE DECIMAL(19,4),
ALTER COLUMN "annualPrice" SET DATA TYPE DECIMAL(19,4);

-- AlterTable
ALTER TABLE "products" ALTER COLUMN "price" SET DATA TYPE DECIMAL(19,4);

-- AlterTable
ALTER TABLE "recurring_posting_lines" ALTER COLUMN "debit" SET DATA TYPE DECIMAL(19,4),
ALTER COLUMN "credit" SET DATA TYPE DECIMAL(19,4);


-- ── Recreate the reporting views ────────────────────────────────────────────
-- Amounts are now Decimal(19,4) major units, so the /100 conversions are gone.
--
-- F13: v_customer_summary.total_invoiced previously used SUM(DISTINCT ...) to
-- blunt row multiplication from the joins to orders, activities and
-- opportunities. SUM(DISTINCT) sums distinct *values*, so a customer with two
-- separate 500.00 invoices reported 500.00 — retainers and standard fees are
-- exactly the repeat-value case that breaks. Each aggregate is now its own
-- scalar subquery, the way open_receivables already did it correctly.

CREATE VIEW v_order_to_cash AS
SELECT
  ai."companyId",
  bp.id AS bp_id, bp."cardCode", bp."cardName",
  o.id  AS order_id,
  ai.id AS invoice_id, ai.number AS invoice_number,
  ai."issueDate", ai."dueDate", ai.status AS invoice_status, ai.currency,
  ai.total                        AS invoice_total,
  ai.paid                         AS invoice_paid,
  ai.total - ai.paid              AS outstanding,
  CASE WHEN ai."dueDate" IS NULL THEN NULL
       ELSE GREATEST(0, DATE_PART('day', now() - ai."dueDate")::int) END AS days_overdue,
  (SELECT COUNT(*)          FROM ar_payments p WHERE p."invoiceId" = ai.id) AS payment_count,
  (SELECT COALESCE(SUM(p.amount),0) FROM ar_payments p WHERE p."invoiceId" = ai.id) AS payments_received,
  je.number AS journal_number,
  je.status AS journal_status
FROM ar_invoices ai
JOIN business_partners bp    ON bp.id = ai."bpId"
LEFT JOIN orders o           ON o.id  = ai."orderId"
LEFT JOIN journal_entries je ON je.id = ai."journalEntryId";

CREATE VIEW v_customer_summary AS
SELECT
  bp.id, bp."companyId", bp."cardCode", bp."cardName", bp."cardType",
  bp.currency, bp."creditLimit",
  (SELECT COUNT(*) FROM orders o        WHERE o."bpId"   = bp.id) AS total_orders,
  (SELECT COUNT(*) FROM ar_invoices i   WHERE i."bpId"   = bp.id AND i.status <> 'VOID') AS total_invoices,
  (SELECT COALESCE(SUM(i.total),0) FROM ar_invoices i
     WHERE i."bpId" = bp.id AND i.status <> 'VOID')               AS total_invoiced,
  (SELECT COALESCE(SUM(i.total - i.paid),0) FROM ar_invoices i
     WHERE i."bpId" = bp.id AND i.status NOT IN ('VOID','DRAFT','PAID')) AS open_receivables,
  (SELECT COUNT(*) FROM activities a    WHERE a."bpId"   = bp.id) AS activity_count,
  (SELECT COUNT(*) FROM opportunities p WHERE p."bpId"   = bp.id) AS opportunity_count,
  (SELECT MAX(a."startDate") FROM activities a WHERE a."bpId" = bp.id) AS last_activity_at
FROM business_partners bp;

CREATE VIEW v_gl_account_balances AS
SELECT
  a."companyId", a.id AS account_id, a.code, a.name, a.type, a.subtype,
  COALESCE(SUM(jl.debit), 0)  AS total_debit,
  COALESCE(SUM(jl.credit), 0) AS total_credit,
  COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.credit), 0) AS raw_balance,
  CASE WHEN a.type IN ('ASSET','EXPENSE')
       THEN COALESCE(SUM(jl.debit),0) - COALESCE(SUM(jl.credit),0)
       ELSE COALESCE(SUM(jl.credit),0) - COALESCE(SUM(jl.debit),0)
  END AS natural_balance
FROM accounts a
LEFT JOIN journal_lines jl   ON jl."accountId" = a.id
LEFT JOIN journal_entries je ON je.id = jl."entryId"
                            AND je.status IN ('POSTED','REVERSED')
GROUP BY a."companyId", a.id, a.code, a.name, a.type, a.subtype;

CREATE VIEW v_procure_to_pay AS
SELECT
  ab."companyId",
  bp.id AS bp_id, bp."cardCode", bp."cardName",
  ab.id AS bill_id, ab.number AS bill_number,
  ab."issueDate", ab."dueDate", ab.status AS bill_status, ab.currency,
  ab.total           AS bill_total,
  ab.paid            AS bill_paid,
  ab.total - ab.paid AS outstanding,
  (SELECT COUNT(*) FROM ap_payments p WHERE p."billId" = ab.id) AS payment_count,
  je.number AS journal_number
FROM ap_bills ab
JOIN business_partners bp    ON bp.id = ab."bpId"
LEFT JOIN journal_entries je ON je.id = ab."journalEntryId";
