-- QA D4: payroll run 7a4cf364… (sap-erp-system) is marked Posted with "JE No"
-- 45754 but has no journal entry: it was set to Posted by hand before Post
-- existed. Nothing in the ledger reflects it. Reset it to Open, clear the JE
-- number, and say why in Remarks.
--
-- The run is typed Regular but has no pay period (only a date range,
-- 2026-10-10 to 2026-12-12). Since 20260926010000 a Regular run must name a
-- pay period (CHECK payroll_runs_regular_needs_period, NOT VALID so old rows
-- were grandfathered — but any update re-checks the row). Picking a period
-- would be a guess, so the run becomes Off-cycle, the type for a date-range
-- run, and Remarks says so. (Reported to QA as a necessary part of D4.)
--
-- payroll_runs_lock (20260926050000) refuses to reopen a posted run — rightly,
-- for a real one. It is disabled for this single, fully guarded update and
-- re-enabled in the same transaction. The guard (this id, status Posted, no
-- journal entry) makes a replay, or any other database, a no-op.

DO $$
DECLARE
  r RECORD;
  n INT;
BEGIN
  SELECT pr."id", pr."status", pr."jeNo", pr."journalEntryId", c."name" AS company INTO r
  FROM "payroll_runs" pr JOIN "companies" c ON c."id" = pr."companyId"
  WHERE pr."id" = '7a4cf364-8aec-4012-a5b4-14db4d3dba18';
  IF r."id" IS NULL THEN
    RAISE NOTICE '[D4] run 7a4cf364: not in this database, skipped';
    RETURN;
  END IF;
  IF r."status" <> 'Posted' OR r."journalEntryId" IS NOT NULL THEN
    RAISE NOTICE '[D4] % run 7a4cf364: status %, journal entry % — nothing to reset', r.company, r."status", COALESCE(r."journalEntryId", 'none');
    RETURN;
  END IF;

  ALTER TABLE "payroll_runs" DISABLE TRIGGER payroll_runs_lock;
  UPDATE "payroll_runs"
  SET "status" = 'Open',
      "jeNo" = NULL,
      "runType" = CASE WHEN "runType" = 'Regular' AND "payPeriodId" IS NULL THEN 'Off-cycle' ELSE "runType" END,
      "remarks" = CONCAT_WS(' ', NULLIF("remarks", ''), '[QA D4] reset: marked Posted without a journal entry',
                  CASE WHEN "runType" = 'Regular' AND "payPeriodId" IS NULL
                       THEN '(type Regular -> Off-cycle: it has no pay period, only a date range)' END),
      "updatedAt" = now()
  WHERE "id" = r."id" AND "status" = 'Posted' AND "journalEntryId" IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  ALTER TABLE "payroll_runs" ENABLE TRIGGER payroll_runs_lock;
  RAISE NOTICE '[D4] % run 7a4cf364: Posted (JE No %, no journal entry) -> Open, now % (% row)', r.company, r."jeNo",
    (SELECT "runType" FROM "payroll_runs" WHERE "id" = r."id"), n;
END $$;
