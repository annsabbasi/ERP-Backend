-- QA D30 (E5a): only an Approved attendance sheet feeds payroll, so a
-- sheet's status becomes a checked enum: Open → Approved.
--
-- Existing values: the sheet window offered "Open" and "Closed". Closed was
-- the finished state, so it becomes Approved and keeps feeding payroll as it
-- does today. Anything else (NULL, "Open", free text) becomes Open — and an
-- Open sheet no longer feeds payroll: HR must approve it before the next
-- Generate, or those employees are treated as present. Every sheet left Open
-- is listed below (NOTICE) for the release notes.
--
-- Idempotent: the updates only touch non-conforming rows; the constraint is
-- added once.

DO $$
DECLARE
  r RECORD;
  n_approved INT;
  n_open INT;
BEGIN
  UPDATE "monthly_attendance_sheets" SET "status" = 'Approved', "updatedAt" = now()
  WHERE "status" = 'Closed';
  GET DIAGNOSTICS n_approved = ROW_COUNT;
  UPDATE "monthly_attendance_sheets" SET "status" = 'Open', "updatedAt" = now()
  WHERE "status" IS NULL OR "status" NOT IN ('Open', 'Approved');
  GET DIAGNOSTICS n_open = ROW_COUNT;
  RAISE NOTICE '[attendance sheet status] Closed -> Approved: %, other -> Open: %', n_approved, n_open;

  FOR r IN
    SELECT c."name" AS company, s."id", COALESCE(b."name", 'no branch') AS branch,
           COALESCE(p."name", s."payPeriodMonth", '?') AS period
    FROM "monthly_attendance_sheets" s
    JOIN "companies" c ON c."id" = s."companyId"
    LEFT JOIN "branches" b ON b."id" = s."branchId"
    LEFT JOIN "pay_periods" p ON p."id" = s."payPeriodId"
    WHERE s."status" = 'Open'
    ORDER BY c."name", period, branch
  LOOP
    RAISE NOTICE '[attendance sheet status] OPEN (approve before the next Generate): % | % | % | sheet %', r.company, r.period, r.branch, r.id;
  END LOOP;
END $$;

ALTER TABLE "monthly_attendance_sheets" ALTER COLUMN "status" SET DEFAULT 'Open';
ALTER TABLE "monthly_attendance_sheets" ALTER COLUMN "status" SET NOT NULL;
DO $$ BEGIN
  ALTER TABLE "monthly_attendance_sheets" ADD CONSTRAINT "monthly_attendance_sheets_status_check"
    CHECK ("status" IN ('Open', 'Approved'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
