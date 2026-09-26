-- Payroll Process, Phase 1 schema.
--
--   * Employee Type becomes a real reference to Employee Category (and Generate
--     now filters on it), plus a run type.
--   * An employee may be in at most one active Regular run per pay period —
--     enforced by the database, not just by the service.
--   * Salary advances get their own deduction column.
--   * A recovery ledger becomes the single source of truth for how much of a
--     loan/advance installment has been recovered, so the same installment can
--     never be deducted twice.
--
-- Existing rows (4 payroll runs on live when this was written) are migrated in
-- place; nothing is deleted and no run's status is changed.

-- ─── Columns ──────────────────────────────────────────────────────────────────
ALTER TABLE "loan_types"
  ADD COLUMN "allowMultipleOpen" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "maxNetPayPercent" DECIMAL(9,4);

ALTER TABLE "payroll_runs"
  ADD COLUMN "employeeCategoryId" TEXT,
  ADD COLUMN "runType" TEXT NOT NULL DEFAULT 'Regular';

ALTER TABLE "payroll_run_lines"
  ADD COLUMN "advanceDeduction" DECIMAL(19,4),
  ADD COLUMN "companyId" TEXT,
  ADD COLUMN "payPeriodId" TEXT,
  ADD COLUMN "runActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "runType" TEXT;

CREATE INDEX "payroll_runs_employeeCategoryId_idx" ON "payroll_runs"("employeeCategoryId");
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_employeeCategoryId_fkey"
  FOREIGN KEY ("employeeCategoryId") REFERENCES "employee_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Existing runs: Employee Type text → Employee Category ───────────────────
-- Matched on the company's own category code or name, case-insensitively.
-- "all" / blank mean every employee, which is what NULL now means. Anything
-- else that matches no category is left NULL (= All) and the old text is kept
-- in remarks so nothing the user typed is lost.
UPDATE "payroll_runs" r
SET "employeeCategoryId" = ec."id"
FROM "employee_categories" ec
WHERE ec."companyId" = r."companyId"
  AND r."employeeType" IS NOT NULL
  AND (lower(trim(r."employeeType")) = lower(ec."code") OR lower(trim(r."employeeType")) = lower(ec."name"));

DO $$
DECLARE rec RECORD;
BEGIN
  FOR rec IN
    SELECT "id", "employeeType" FROM "payroll_runs"
    WHERE "employeeCategoryId" IS NULL
      AND "employeeType" IS NOT NULL
      AND lower(trim("employeeType")) NOT IN ('', 'all')
  LOOP
    UPDATE "payroll_runs"
    SET "remarks" = concat_ws(E'\n', "remarks", format('[migrated] Employee Type was "%s" (no matching category; treated as All).', rec."employeeType"))
    WHERE "id" = rec."id";
    RAISE NOTICE 'payroll run %: employee type "%" matched no category, left as All', rec."id", rec."employeeType";
  END LOOP;
END $$;

UPDATE "payroll_run_lines" SET "advanceDeduction" = 0 WHERE "advanceDeduction" IS NULL;

-- ─── Run type and status vocabularies ────────────────────────────────────────
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_run_type_check"
  CHECK ("runType" IN ('Regular', 'Supplementary', 'Off-cycle', 'Bonus'));

ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_status_check"
  CHECK ("status" IS NULL OR "status" IN ('Open', 'Posted', 'Partially Paid', 'Paid', 'Cancelled'));

-- A Regular run without a pay period would escape the uniqueness index below
-- (NULLs never collide). NOT VALID: enforced for every new or changed row, but
-- not retro-checked, because one run on live predates this rule and has no
-- period — what happens to it is the owner's decision, not this migration's.
-- Once it is resolved: ALTER TABLE "payroll_runs" VALIDATE CONSTRAINT "payroll_runs_regular_needs_period";
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_regular_needs_period"
  CHECK ("runType" <> 'Regular' OR "payPeriodId" IS NOT NULL) NOT VALID;

-- ─── Lines mirror their run (for the uniqueness index) ───────────────────────
-- An index can only see its own table, so the run's company, period, type and
-- active flag are copied onto every line. Triggers own these columns: a line
-- always takes them from its run on insert/update, and a change to the run
-- pushes down to its lines in the same statement — including Post and Cancel.
CREATE OR REPLACE FUNCTION payroll_run_lines_sync_from_run() RETURNS trigger AS $$
BEGIN
  SELECT r."companyId", r."payPeriodId", r."runType", (r."status" IS DISTINCT FROM 'Cancelled')
    INTO NEW."companyId", NEW."payPeriodId", NEW."runType", NEW."runActive"
  FROM "payroll_runs" r WHERE r."id" = NEW."payrollRunId";
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER payroll_run_lines_sync_from_run
  BEFORE INSERT OR UPDATE ON "payroll_run_lines"
  FOR EACH ROW EXECUTE FUNCTION payroll_run_lines_sync_from_run();

CREATE OR REPLACE FUNCTION payroll_runs_sync_to_lines() RETURNS trigger AS $$
BEGIN
  IF NEW."companyId"   IS DISTINCT FROM OLD."companyId"
  OR NEW."payPeriodId" IS DISTINCT FROM OLD."payPeriodId"
  OR NEW."runType"     IS DISTINCT FROM OLD."runType"
  OR NEW."status"      IS DISTINCT FROM OLD."status" THEN
    -- The BEFORE trigger on lines re-reads the run, so touching the rows is enough.
    UPDATE "payroll_run_lines" SET "runActive" = "runActive" WHERE "payrollRunId" = NEW."id";
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER payroll_runs_sync_to_lines
  AFTER UPDATE ON "payroll_runs"
  FOR EACH ROW EXECUTE FUNCTION payroll_runs_sync_to_lines();

-- Backfill existing lines through the trigger.
UPDATE "payroll_run_lines" SET "runActive" = "runActive";

-- One active Regular run per employee per pay period. Checked on live before
-- this was written: no employee appeared twice in any period.
CREATE UNIQUE INDEX "payroll_run_lines_one_regular_run_per_period"
  ON "payroll_run_lines" ("companyId", "payPeriodId", "employeeId")
  WHERE "runType" = 'Regular' AND "runActive";

-- ─── Recovery ledger ─────────────────────────────────────────────────────────
CREATE TABLE "loan_recoveries" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "installmentId" TEXT NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "source" TEXT NOT NULL,
    "payrollRunId" TEXT,
    "payrollRunLineId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" TIMESTAMP(3),
    "reversedById" TEXT,

    CONSTRAINT "loan_recoveries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "loan_recoveries_amount_positive" CHECK ("amount" > 0),
    CONSTRAINT "loan_recoveries_source_check" CHECK ("source" IN ('payroll', 'payment')),
    CONSTRAINT "loan_recoveries_payroll_has_run" CHECK ("source" <> 'payroll' OR "payrollRunId" IS NOT NULL)
);

CREATE INDEX "loan_recoveries_companyId_idx" ON "loan_recoveries"("companyId");
CREATE INDEX "loan_recoveries_installmentId_idx" ON "loan_recoveries"("installmentId");
CREATE INDEX "loan_recoveries_loanId_idx" ON "loan_recoveries"("loanId");
CREATE INDEX "loan_recoveries_payrollRunId_idx" ON "loan_recoveries"("payrollRunId");

ALTER TABLE "loan_recoveries" ADD CONSTRAINT "loan_recoveries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "loan_recoveries" ADD CONSTRAINT "loan_recoveries_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "employee_loans"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "loan_recoveries" ADD CONSTRAINT "loan_recoveries_installmentId_fkey" FOREIGN KEY ("installmentId") REFERENCES "employee_loan_installments"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "loan_recoveries" ADD CONSTRAINT "loan_recoveries_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "payroll_runs"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "loan_recoveries" ADD CONSTRAINT "loan_recoveries_payrollRunLineId_fkey" FOREIGN KEY ("payrollRunLineId") REFERENCES "payroll_run_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Guard: lock the installment, refuse anything that would recover it past its
-- amount, and refuse edits to a recovery other than stamping its reversal.
-- The FOR UPDATE is what serialises two concurrent recoveries of the same
-- installment: the second waits, then sees the first one's row.
CREATE OR REPLACE FUNCTION loan_recoveries_guard() RETURNS trigger AS $$
DECLARE
  inst_amount DECIMAL(19,4);
  inst_loan   TEXT;
  recovered   DECIMAL(19,4);
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD."reversedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'ERP_RULE: Loan recovery % is already reversed', OLD."id" USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."amount" <> OLD."amount" OR NEW."installmentId" <> OLD."installmentId"
       OR NEW."loanId" <> OLD."loanId" OR NEW."source" <> OLD."source"
       OR NEW."payrollRunId" IS DISTINCT FROM OLD."payrollRunId" THEN
      RAISE EXCEPTION 'ERP_RULE: A loan recovery cannot be edited; reverse it instead' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  SELECT i."amount", i."loanId" INTO inst_amount, inst_loan
  FROM "employee_loan_installments" i WHERE i."id" = NEW."installmentId" FOR UPDATE;

  IF inst_loan IS DISTINCT FROM NEW."loanId" THEN
    RAISE EXCEPTION 'ERP_RULE: Installment % does not belong to loan %', NEW."installmentId", NEW."loanId" USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(SUM(r."amount"), 0) INTO recovered
  FROM "loan_recoveries" r
  WHERE r."installmentId" = NEW."installmentId" AND r."reversedAt" IS NULL;

  IF recovered + NEW."amount" > inst_amount THEN
    RAISE EXCEPTION 'ERP_RULE: LOAN_OVER_RECOVERY — installment % has % outstanding, cannot recover %',
      NEW."installmentId", inst_amount - recovered, NEW."amount" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER loan_recoveries_guard
  BEFORE INSERT OR UPDATE ON "loan_recoveries"
  FOR EACH ROW EXECUTE FUNCTION loan_recoveries_guard();

-- Installment and loan status follow the ledger — never set independently.
CREATE OR REPLACE FUNCTION loan_recoveries_apply() RETURNS trigger AS $$
DECLARE
  inst_amount DECIMAL(19,4);
  recovered   DECIMAL(19,4);
  open_count  INT;
BEGIN
  SELECT i."amount" INTO inst_amount FROM "employee_loan_installments" i WHERE i."id" = NEW."installmentId";
  SELECT COALESCE(SUM(r."amount"), 0) INTO recovered
  FROM "loan_recoveries" r WHERE r."installmentId" = NEW."installmentId" AND r."reversedAt" IS NULL;

  UPDATE "employee_loan_installments"
  SET "status" = CASE WHEN recovered >= inst_amount THEN 'Paid'
                      WHEN recovered > 0 THEN 'Partially Paid'
                      ELSE 'Pending' END
  WHERE "id" = NEW."installmentId";

  SELECT count(*) INTO open_count FROM "employee_loan_installments"
  WHERE "loanId" = NEW."loanId" AND "status" IS DISTINCT FROM 'Paid';

  UPDATE "employee_loans"
  SET "status" = CASE WHEN open_count = 0 THEN 'Recovered'
                      WHEN "status" = 'Recovered' THEN 'Open'
                      ELSE "status" END
  WHERE "id" = NEW."loanId" AND "status" IS DISTINCT FROM 'Cancelled';
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER loan_recoveries_apply
  AFTER INSERT OR UPDATE ON "loan_recoveries"
  FOR EACH ROW EXECUTE FUNCTION loan_recoveries_apply();

-- A recovery is permanent history: undo means stamping reversedAt. The one
-- exception is the whole company being deleted — by the time its cascade
-- reaches this table the company row is already gone.
CREATE OR REPLACE FUNCTION loan_recoveries_no_delete() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "companies" c WHERE c."id" = OLD."companyId") THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'ERP_RULE: Loan recoveries cannot be deleted; reverse them instead' USING ERRCODE = 'check_violation';
END $$ LANGUAGE plpgsql;

CREATE TRIGGER loan_recoveries_no_delete
  BEFORE DELETE ON "loan_recoveries"
  FOR EACH ROW EXECUTE FUNCTION loan_recoveries_no_delete();
