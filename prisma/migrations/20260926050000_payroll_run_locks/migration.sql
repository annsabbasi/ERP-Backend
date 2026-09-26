-- Database backstops for the payroll run lock (QA Round 3, Q1–Q3).
--
-- The service now takes the run's row lock and re-checks its status inside
-- every write (Post, Cancel, Save Grid, Generate). These make the same rules
-- hold for any path that does not go through the service — a script, a raw
-- SQL session, a future endpoint that forgets.
--
-- Every refusal is tagged ERP_RULE:, which the API's exception filter turns
-- into a readable 409 instead of an anonymous 500.

-- ─── Q1: one payroll journal entry per run, ever ─────────────────────────────
-- A reversal is written with source 'reversal' (reverseFromSource), so the
-- original and its reversal never collide here. A cancelled run cannot be
-- posted again, so there is never a legitimate second payroll_run entry.
CREATE UNIQUE INDEX "journal_entries_one_per_payroll_run"
  ON "journal_entries" ("companyId", "source", "sourceId")
  WHERE "source" = 'payroll_run';

-- ─── Q2: a run's lines are frozen once it leaves Open ────────────────────────
-- Allowed on a non-Open run: an UPDATE that only touches the mirror columns
-- (payroll_runs_sync_to_lines pushing the new status down), and the cascade
-- of a whole-company delete. Everything else is refused.
CREATE OR REPLACE FUNCTION payroll_run_lines_lock() RETURNS trigger AS $$
DECLARE
  run_status TEXT;
  run_found  BOOLEAN;
  mirror     TEXT[] := ARRAY['companyId', 'payPeriodId', 'runType', 'runActive'];
BEGIN
  SELECT true, r."status" INTO run_found, run_status
  FROM "payroll_runs" r WHERE r."id" = COALESCE(NEW."payrollRunId", OLD."payrollRunId");

  IF run_found IS NULL THEN
    RETURN COALESCE(NEW, OLD);            -- parent already gone: cascade delete
  END IF;
  IF run_status IS NULL OR run_status = 'Open' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - mirror) = (to_jsonb(OLD) - mirror) THEN
    RETURN NEW;                           -- status sync from the run, nothing else
  END IF;
  RAISE EXCEPTION 'ERP_RULE: This payroll run is % — its lines can no longer change.', lower(run_status)
    USING ERRCODE = 'check_violation';
END $$ LANGUAGE plpgsql;

-- Named to sort before payroll_run_lines_sync_from_run, so it judges the row
-- as the caller wrote it, before the sync trigger fills the mirror columns.
CREATE TRIGGER payroll_run_lines_lock
  BEFORE INSERT OR UPDATE OR DELETE ON "payroll_run_lines"
  FOR EACH ROW EXECUTE FUNCTION payroll_run_lines_lock();

-- ─── The run itself once it leaves Open ──────────────────────────────────────
-- Posted may move forward (Cancelled; Partially Paid / Paid from Phase 2) and
-- may take notes in remarks. It may not go back to Open, change what it was
-- computed from, or change which journal entry it points at. Cancelled is final.
CREATE OR REPLACE FUNCTION payroll_runs_lock() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" IS NULL OR OLD."status" = 'Open'
       OR NOT EXISTS (SELECT 1 FROM "companies" c WHERE c."id" = OLD."companyId") THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'ERP_RULE: Payroll run % is % and cannot be deleted.', COALESCE(OLD."jeNo", OLD."id"), lower(OLD."status")
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD."status" IS NULL OR OLD."status" = 'Open' THEN
    RETURN NEW;
  END IF;
  IF OLD."status" = 'Cancelled' THEN
    RAISE EXCEPTION 'ERP_RULE: Payroll run % is cancelled; a cancelled run is kept as history and cannot change.', COALESCE(OLD."jeNo", OLD."id")
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" IS NULL OR NEW."status" = 'Open' THEN
    RAISE EXCEPTION 'ERP_RULE: Payroll run % is %; it cannot be reopened. Cancel Posting reverses it instead.', COALESCE(OLD."jeNo", OLD."id"), lower(OLD."status")
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."companyId"          IS DISTINCT FROM OLD."companyId"
  OR NEW."payPeriodId"        IS DISTINCT FROM OLD."payPeriodId"
  OR NEW."runType"            IS DISTINCT FROM OLD."runType"
  OR NEW."employeeCategoryId" IS DISTINCT FROM OLD."employeeCategoryId"
  OR NEW."fromDate"           IS DISTINCT FROM OLD."fromDate"
  OR NEW."toDate"             IS DISTINCT FROM OLD."toDate"
  OR NEW."documentDate"       IS DISTINCT FROM OLD."documentDate"
  OR NEW."journalEntryId"     IS DISTINCT FROM OLD."journalEntryId"
  OR NEW."jeNo"               IS DISTINCT FROM OLD."jeNo" THEN
    RAISE EXCEPTION 'ERP_RULE: Payroll run % is %; its period, dates, type, category and journal entry can no longer change.', COALESCE(OLD."jeNo", OLD."id"), lower(OLD."status")
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER payroll_runs_lock
  BEFORE UPDATE OR DELETE ON "payroll_runs"
  FOR EACH ROW EXECUTE FUNCTION payroll_runs_lock();
