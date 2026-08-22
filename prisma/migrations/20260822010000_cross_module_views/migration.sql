-- ============================================================================
-- Cross-module reporting views (roadmap section 28)
--
-- These join across module boundaries so reports read one source instead of
-- stitching modules together in application code.
--
-- Prisma does not manage views (the `views` preview feature is off), so these
-- are invisible to `migrate diff` and will not be dropped by future migrations.
--
-- Ledger figures include POSTED and REVERSED entries. A reversal neutralizes
-- an entry by posting its mirror; excluding the original would keep the
-- reversal and drop what it reverses, shifting every balance the wrong way.
-- ============================================================================

-- Order-to-cash: one row per receivable, tracing customer -> order -> invoice
-- -> payments -> general ledger.
CREATE OR REPLACE VIEW v_order_to_cash AS
SELECT
  ai."companyId",
  bp.id            AS bp_id,
  bp."cardCode",
  bp."cardName",
  o.id             AS order_id,
  ai.id            AS invoice_id,
  ai.number        AS invoice_number,
  ai."issueDate",
  ai."dueDate",
  ai.status        AS invoice_status,
  ai.currency,
  ai."totalMinor"  / 100.0 AS invoice_total,
  ai."paidMinor"   / 100.0 AS invoice_paid,
  (ai."totalMinor" - ai."paidMinor") / 100.0 AS outstanding,
  CASE WHEN ai."dueDate" IS NULL THEN NULL
       ELSE GREATEST(0, DATE_PART('day', now() - ai."dueDate")::int) END AS days_overdue,
  COUNT(ap.id)                     AS payment_count,
  COALESCE(SUM(ap."amountMinor"),0) / 100.0 AS payments_received,
  je.number                        AS journal_number,
  je.status                        AS journal_status
FROM ar_invoices ai
JOIN business_partners bp ON bp.id = ai."bpId"
LEFT JOIN orders o          ON o.id  = ai."orderId"
LEFT JOIN ar_payments ap    ON ap."invoiceId" = ai.id
LEFT JOIN journal_entries je ON je.id = ai."journalEntryId"
GROUP BY ai."companyId", bp.id, bp."cardCode", bp."cardName", o.id, ai.id,
         ai.number, ai."issueDate", ai."dueDate", ai.status, ai.currency,
         ai."totalMinor", ai."paidMinor", je.number, je.status;

-- Customer summary across CRM, Sales and Finance (the roadmap's own example).
CREATE OR REPLACE VIEW v_customer_summary AS
SELECT
  bp.id, bp."companyId", bp."cardCode", bp."cardName", bp."cardType",
  bp.currency, bp."creditLimit",
  COUNT(DISTINCT o.id)   AS total_orders,
  COUNT(DISTINCT ai.id)  AS total_invoices,
  COALESCE(SUM(DISTINCT ai."totalMinor"),0) / 100.0 AS total_invoiced,
  COALESCE((SELECT SUM(x."totalMinor" - x."paidMinor")
            FROM ar_invoices x
            WHERE x."bpId" = bp.id
              AND x.status NOT IN ('VOID','DRAFT','PAID')), 0) / 100.0 AS open_receivables,
  COUNT(DISTINCT act.id) AS activity_count,
  COUNT(DISTINCT opp.id) AS opportunity_count,
  MAX(act."startDate")   AS last_activity_at
FROM business_partners bp
LEFT JOIN orders o        ON o."bpId"  = bp.id
LEFT JOIN ar_invoices ai  ON ai."bpId" = bp.id AND ai.status <> 'VOID'
LEFT JOIN activities act  ON act."bpId" = bp.id
LEFT JOIN opportunities opp ON opp."bpId" = bp.id
GROUP BY bp.id, bp."companyId", bp."cardCode", bp."cardName", bp."cardType",
         bp.currency, bp."creditLimit";

-- General-ledger balance per account, the shared basis for trial balance,
-- balance sheet and P&L.
CREATE OR REPLACE VIEW v_gl_account_balances AS
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

-- Procure-to-pay counterpart, for vendor-side reporting.
CREATE OR REPLACE VIEW v_procure_to_pay AS
SELECT
  ab."companyId",
  bp.id AS bp_id, bp."cardCode", bp."cardName",
  ab.id AS bill_id, ab.number AS bill_number,
  ab."issueDate", ab."dueDate", ab.status AS bill_status, ab.currency,
  ab."totalMinor" / 100.0 AS bill_total,
  ab."paidMinor"  / 100.0 AS bill_paid,
  (ab."totalMinor" - ab."paidMinor") / 100.0 AS outstanding,
  COUNT(app.id) AS payment_count,
  je.number AS journal_number
FROM ap_bills ab
JOIN business_partners bp ON bp.id = ab."bpId"
LEFT JOIN ap_payments app ON app."billId" = ab.id
LEFT JOIN journal_entries je ON je.id = ab."journalEntryId"
GROUP BY ab."companyId", bp.id, bp."cardCode", bp."cardName", ab.id, ab.number,
         ab."issueDate", ab."dueDate", ab.status, ab.currency,
         ab."totalMinor", ab."paidMinor", je.number;
