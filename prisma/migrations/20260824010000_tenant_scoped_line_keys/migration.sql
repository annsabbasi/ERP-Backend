-- ============================================================================
-- V5 — Tenant-scoped foreign keys on the four line tables
--
-- Until now a line row carried only a bare parent id: journal_lines.accountId
-- referenced accounts(id), so nothing at the database level stopped a line in
-- company A from pointing at an account belonging to company B. Tenant
-- isolation rested entirely on the application always remembering to filter.
-- The composite key accounts(companyId, id) already existed and nothing
-- referenced it.
--
-- Each line table now carries its own companyId and every foreign key becomes
-- (companyId, parentId) -> parent(companyId, id). Crossing a tenant boundary
-- stops being a bug the application can commit and becomes a constraint
-- violation.
--
-- Optional parents stay optional: these are MATCH SIMPLE foreign keys, so a
-- NULL in any column skips the check entirely. A line with no cost center is
-- unaffected; a line that has one must have it in its own company.
--
-- Verified against the live database before writing: 10 journal lines, 0
-- ar_invoice_lines, 0 ap_bill_lines, 0 order_items, and zero cross-tenant
-- references in any of them.
-- ============================================================================

-- ── Drop the untenanted foreign keys ────────────────────────────────────────
ALTER TABLE "journal_lines"    DROP CONSTRAINT "journal_lines_entryId_fkey";
ALTER TABLE "journal_lines"    DROP CONSTRAINT "journal_lines_accountId_fkey";
ALTER TABLE "journal_lines"    DROP CONSTRAINT "journal_lines_bpId_fkey";
ALTER TABLE "journal_lines"    DROP CONSTRAINT "journal_lines_costCenterId_fkey";
ALTER TABLE "journal_lines"    DROP CONSTRAINT "journal_lines_distributionRuleId_fkey";
ALTER TABLE "journal_lines"    DROP CONSTRAINT "journal_lines_projectId_fkey";
ALTER TABLE "journal_lines"    DROP CONSTRAINT "journal_lines_taxCodeId_fkey";
ALTER TABLE "ar_invoice_lines" DROP CONSTRAINT "ar_invoice_lines_invoiceId_fkey";
ALTER TABLE "ar_invoice_lines" DROP CONSTRAINT "ar_invoice_lines_accountId_fkey";
ALTER TABLE "ar_invoice_lines" DROP CONSTRAINT "ar_invoice_lines_productId_fkey";
ALTER TABLE "ap_bill_lines"    DROP CONSTRAINT "ap_bill_lines_billId_fkey";
ALTER TABLE "ap_bill_lines"    DROP CONSTRAINT "ap_bill_lines_accountId_fkey";
ALTER TABLE "order_items"      DROP CONSTRAINT "order_items_orderId_fkey";
ALTER TABLE "order_items"      DROP CONSTRAINT "order_items_productId_fkey";

-- ── Add the column, nullable, so existing rows survive the statement ────────
ALTER TABLE "journal_lines"    ADD COLUMN "companyId" TEXT;
ALTER TABLE "ar_invoice_lines" ADD COLUMN "companyId" TEXT;
ALTER TABLE "ap_bill_lines"    ADD COLUMN "companyId" TEXT;
ALTER TABLE "order_items"      ADD COLUMN "companyId" TEXT;

-- ── Backfill from the parent ────────────────────────────────────────────────
-- journal_line_guard refuses any UPDATE to a line belonging to a posted entry,
-- which is exactly what this backfill is. The guard is doing its job; it just
-- cannot tell a schema migration apart from an edit. Suspend it for the
-- backfill only. journal_line_balance_guard stays enabled, so the posted
-- entries are still checked to reconcile after the rewrite.
ALTER TABLE "journal_lines" DISABLE TRIGGER "journal_line_guard";

UPDATE "journal_lines" l    SET "companyId" = e."companyId"
  FROM "journal_entries" e  WHERE e.id = l."entryId";
UPDATE "ar_invoice_lines" l SET "companyId" = i."companyId"
  FROM "ar_invoices" i      WHERE i.id = l."invoiceId";
UPDATE "ap_bill_lines" l    SET "companyId" = b."companyId"
  FROM "ap_bills" b         WHERE b.id = l."billId";
UPDATE "order_items" l      SET "companyId" = o."companyId"
  FROM "orders" o           WHERE o.id = l."orderId";

-- The backfill queued deferred events on journal_line_balance_guard, and
-- Postgres refuses to ALTER a table that has trigger events pending. Flushing
-- them now both clears the way for the statements below and runs the balance
-- check at a point where a failure still names the backfill as the cause.
SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE "journal_lines" ENABLE TRIGGER "journal_line_guard";

-- ── Fail loudly rather than through a bare NOT NULL error ───────────────────
-- A row left NULL here is an orphan: its parent no longer exists. That is a
-- data problem worth looking at, not something to paper over with a default.
DO $do$
DECLARE t text; n bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY['journal_lines','ar_invoice_lines','ap_bill_lines','order_items'] LOOP
    EXECUTE format('SELECT COUNT(*) FROM %I WHERE "companyId" IS NULL', t) INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION
        '% has % orphaned row(s) with no surviving parent; resolve them before tenant-scoping the keys.', t, n;
    END IF;
  END LOOP;
END
$do$;

ALTER TABLE "journal_lines"    ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "ar_invoice_lines" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "ap_bill_lines"    ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "order_items"      ALTER COLUMN "companyId" SET NOT NULL;

-- ── The composite keys the new foreign keys point at ────────────────────────
-- accounts, ar_invoices, ap_bills, orders and business_partners already have
-- theirs from the earlier composite-key migration.
CREATE UNIQUE INDEX "journal_entries_companyId_id_key"    ON "journal_entries"("companyId", "id");
CREATE UNIQUE INDEX "products_companyId_id_key"           ON "products"("companyId", "id");
CREATE UNIQUE INDEX "cost_centers_companyId_id_key"       ON "cost_centers"("companyId", "id");
CREATE UNIQUE INDEX "distribution_rules_companyId_id_key" ON "distribution_rules"("companyId", "id");
CREATE UNIQUE INDEX "finance_projects_companyId_id_key"   ON "finance_projects"("companyId", "id");
CREATE UNIQUE INDEX "tax_codes_companyId_id_key"          ON "tax_codes"("companyId", "id");

CREATE INDEX "journal_lines_companyId_idx"    ON "journal_lines"("companyId");
CREATE INDEX "ar_invoice_lines_companyId_idx" ON "ar_invoice_lines"("companyId");
CREATE INDEX "ap_bill_lines_companyId_idx"    ON "ap_bill_lines"("companyId");
CREATE INDEX "order_items_companyId_idx"      ON "order_items"("companyId");

-- ── The tenant-scoped foreign keys ──────────────────────────────────────────
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_companyId_entryId_fkey"
  FOREIGN KEY ("companyId", "entryId") REFERENCES "journal_entries"("companyId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_companyId_accountId_fkey"
  FOREIGN KEY ("companyId", "accountId") REFERENCES "accounts"("companyId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_companyId_bpId_fkey"
  FOREIGN KEY ("companyId", "bpId") REFERENCES "business_partners"("companyId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_companyId_costCenterId_fkey"
  FOREIGN KEY ("companyId", "costCenterId") REFERENCES "cost_centers"("companyId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_companyId_distributionRuleId_fkey"
  FOREIGN KEY ("companyId", "distributionRuleId") REFERENCES "distribution_rules"("companyId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_companyId_projectId_fkey"
  FOREIGN KEY ("companyId", "projectId") REFERENCES "finance_projects"("companyId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_companyId_taxCodeId_fkey"
  FOREIGN KEY ("companyId", "taxCodeId") REFERENCES "tax_codes"("companyId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ar_invoice_lines" ADD CONSTRAINT "ar_invoice_lines_companyId_invoiceId_fkey"
  FOREIGN KEY ("companyId", "invoiceId") REFERENCES "ar_invoices"("companyId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ar_invoice_lines" ADD CONSTRAINT "ar_invoice_lines_companyId_accountId_fkey"
  FOREIGN KEY ("companyId", "accountId") REFERENCES "accounts"("companyId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ar_invoice_lines" ADD CONSTRAINT "ar_invoice_lines_companyId_productId_fkey"
  FOREIGN KEY ("companyId", "productId") REFERENCES "products"("companyId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ap_bill_lines" ADD CONSTRAINT "ap_bill_lines_companyId_billId_fkey"
  FOREIGN KEY ("companyId", "billId") REFERENCES "ap_bills"("companyId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ap_bill_lines" ADD CONSTRAINT "ap_bill_lines_companyId_accountId_fkey"
  FOREIGN KEY ("companyId", "accountId") REFERENCES "accounts"("companyId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "order_items" ADD CONSTRAINT "order_items_companyId_orderId_fkey"
  FOREIGN KEY ("companyId", "orderId") REFERENCES "orders"("companyId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_companyId_productId_fkey"
  FOREIGN KEY ("companyId", "productId") REFERENCES "products"("companyId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
