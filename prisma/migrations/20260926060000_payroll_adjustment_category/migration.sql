-- Payroll Monthly Adjustments: Employee Type (free text) becomes a reference to
-- Employee Category, the same change 20260926010000 made for payroll runs.
-- Existing rows are matched on category code or name; "all"/blank → NULL (All);
-- anything unmatched stays NULL with the old text kept in remarks.
ALTER TABLE "payroll_adjustments" ADD COLUMN "employeeCategoryId" TEXT;
CREATE INDEX "payroll_adjustments_employeeCategoryId_idx" ON "payroll_adjustments"("employeeCategoryId");
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_employeeCategoryId_fkey"
  FOREIGN KEY ("employeeCategoryId") REFERENCES "employee_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "payroll_adjustments" a
SET "employeeCategoryId" = ec."id"
FROM "employee_categories" ec
WHERE ec."companyId" = a."companyId"
  AND a."employeeType" IS NOT NULL
  AND (lower(trim(a."employeeType")) = lower(ec."code") OR lower(trim(a."employeeType")) = lower(ec."name"));

DO $$
DECLARE rec RECORD;
BEGIN
  FOR rec IN
    SELECT "id", "employeeType" FROM "payroll_adjustments"
    WHERE "employeeCategoryId" IS NULL AND "employeeType" IS NOT NULL
      AND lower(trim("employeeType")) NOT IN ('', 'all')
  LOOP
    UPDATE "payroll_adjustments"
    SET "remarks" = concat_ws(E'\n', "remarks", format('[migrated] Employee Type was "%s" (no matching category; treated as All).', rec."employeeType"))
    WHERE "id" = rec."id";
    RAISE NOTICE 'payroll adjustment %: employee type "%" matched no category, left as All', rec."id", rec."employeeType";
  END LOOP;
END $$;
