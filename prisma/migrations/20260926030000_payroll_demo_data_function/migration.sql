-- Sample payroll data for DEMO / TEST companies only.
--
-- Defines erp_seed_payroll_demo_data(companyId) and calls it for nobody.
-- Which companies are demo is the owner's decision; the calls go in a later
-- migration that names them. Until then this is inert.
--
-- It exists so a demo company's Payroll Process produces non-zero pay, tax,
-- loan, advance and LOP on the first Generate: graded employees across two
-- categories and two departments, a loan with installments, a salary advance,
-- an approved unpaid leave and a tax formula with slabs.
--
-- Everything is guarded: employees by employee number, loans by code, grades
-- by code, stages only for grades that have none, the tax formula by code.
-- No attendance lines are created — an employee without one is treated as
-- present (payroll never infers ~31 LOP days), so the only LOP is the unpaid
-- leave below.
--
-- Requires erp_apply_payroll_defaults (20260926020000) to have run for the
-- company first: it uses the categories, departments, pay periods, the
-- UNPAID leave type and the PL / ADV loan types that function creates.
CREATE OR REPLACE FUNCTION erp_seed_payroll_demo_data(p_company TEXT, p_year INT DEFAULT NULL)
RETURNS SETOF TEXT AS $$
DECLARE
  yr INT := COALESCE(p_year, EXTRACT(YEAR FROM now())::INT);
  cat_perm TEXT;
  cat_cont TEXT;
  dept_a TEXT;
  dept_b TEXT;
  lt_unpaid TEXT;
  lt_pl TEXT;
  lt_adv TEXT;
  emp RECORD;
  loan_id TEXT;
  n INT;
BEGIN
  -- Grades and their first pay-scale stage (monthly amounts).
  INSERT INTO "grades" ("id", "companyId", "code", "description", "overtimeRatePerHour", "updatedAt")
  SELECT gen_random_uuid()::TEXT, p_company, v.code, v.descr, v.ot, now()
  FROM (VALUES ('G1', 'Grade 1 - Junior', 250), ('G2', 'Grade 2 - Mid', 400),
               ('G3', 'Grade 3 - Senior', 600), ('G4', 'Grade 4 - Management', 900)) v(code, descr, ot)
  WHERE NOT EXISTS (SELECT 1 FROM "grades" g WHERE g."companyId" = p_company AND g."code" = v.code);

  INSERT INTO "grade_pay_scale_stages" ("id", "gradeId", "stage", "basicPay", "hra", "utilityAllowance", "medicalAllowance", "conveyanceAllowance")
  SELECT gen_random_uuid()::TEXT, g."id", 1, v.basic, v.hra, v.util, v.med, v.conv
  FROM "grades" g
  JOIN (VALUES ('G1', 40000, 8000, 2000, 2000, 4000), ('G2', 60000, 12000, 3000, 3000, 6000),
               ('G3', 90000, 18000, 4000, 4000, 8000), ('G4', 140000, 28000, 6000, 6000, 12000)) v(code, basic, hra, util, med, conv)
    ON v.code = g."code"
  WHERE g."companyId" = p_company
    AND NOT EXISTS (SELECT 1 FROM "grade_pay_scale_stages" s WHERE s."gradeId" = g."id");
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN RETURN NEXT format('created pay-scale stage 1 for %s grades', n); END IF;

  -- A company-wide tax formula (annual slabs, spread over 12 months).
  IF NOT EXISTS (SELECT 1 FROM "tax_formulas" WHERE "companyId" = p_company AND "code" = 'TX-DEMO') THEN
    WITH f AS (
      INSERT INTO "tax_formulas" ("id", "companyId", "code", "periodYear", "fromDate", "toDate", "noOfMonths", "remarks", "isActive", "updatedAt")
      VALUES (gen_random_uuid()::TEXT, p_company, 'TX-DEMO', yr, make_date(yr, 1, 1), make_date(yr, 12, 31), 12,
              'Sample slabs for demo data — not a real tax table', true, now())
      RETURNING "id"
    )
    INSERT INTO "tax_slabs" ("id", "taxFormulaId", "ordering", "lowerAmount", "higherAmount", "percentage")
    SELECT gen_random_uuid()::TEXT, f."id", v.ord, v.lo, v.hi, v.pct
    FROM f, (VALUES (0, 0, 600000, 0), (1, 600000, 1200000, 5), (2, 1200000, 2200000, 15), (3, 2200000, NULL, 25)) v(ord, lo, hi, pct);
    RETURN NEXT 'created tax formula TX-DEMO with 4 slabs';
  END IF;

  SELECT "id" INTO cat_perm FROM "employee_categories" WHERE "companyId" = p_company AND "code" = 'PERM';
  SELECT "id" INTO cat_cont FROM "employee_categories" WHERE "companyId" = p_company AND "code" = 'CONT';
  SELECT "id" INTO dept_a FROM "departments" WHERE "companyId" = p_company ORDER BY "name" LIMIT 1;
  SELECT "id" INTO dept_b FROM "departments" WHERE "companyId" = p_company ORDER BY "name" OFFSET 1 LIMIT 1;

  -- Eight employees: two categories, two departments, every grade.
  INSERT INTO "employees" ("id", "companyId", "employeeNumber", "name", "email", "departmentId", "employeeCategoryId",
                           "gradeId", "hireDate", "dateOfJoining", "isActive", "updatedAt")
  SELECT gen_random_uuid()::TEXT, p_company, v.num, v.name, lower(replace(v.name, ' ', '.')) || '@demo.example',
    CASE WHEN v.i % 2 = 0 THEN dept_a ELSE COALESCE(dept_b, dept_a) END,
    CASE WHEN v.i <= 5 THEN cat_perm ELSE cat_cont END,
    (SELECT g."id" FROM "grades" g WHERE g."companyId" = p_company AND g."code" = v.grade),
    make_date(yr - 1, 1, 1), make_date(yr - 1, 1, 1), true, now()
  FROM (VALUES (1, 'DEMO-001', 'Ayesha Khan', 'G4'), (2, 'DEMO-002', 'Bilal Ahmed', 'G3'),
               (3, 'DEMO-003', 'Sana Tariq', 'G2'), (4, 'DEMO-004', 'Usman Ali', 'G2'),
               (5, 'DEMO-005', 'Hina Raza', 'G1'), (6, 'DEMO-006', 'Omar Farooq', 'G3'),
               (7, 'DEMO-007', 'Zara Malik', 'G1'), (8, 'DEMO-008', 'Faisal Iqbal', 'G2')) v(i, num, name, grade)
  WHERE NOT EXISTS (SELECT 1 FROM "employees" e WHERE e."companyId" = p_company AND e."employeeNumber" = v.num);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN RETURN NEXT format('created %s demo employees', n); END IF;

  SELECT "id" INTO lt_pl FROM "loan_types" WHERE "companyId" = p_company AND lower("loanType") = 'personal' ORDER BY "code" LIMIT 1;
  SELECT "id" INTO lt_adv FROM "loan_types" WHERE "companyId" = p_company AND lower("loanType") = 'advance' ORDER BY "code" LIMIT 1;
  SELECT "id" INTO lt_unpaid FROM "leave_types" WHERE "companyId" = p_company AND NOT "paid" ORDER BY "code" LIMIT 1;

  -- A 60,000 personal loan for DEMO-002: 12 × 5,000 from January.
  SELECT * INTO emp FROM "employees" WHERE "companyId" = p_company AND "employeeNumber" = 'DEMO-002';
  IF lt_pl IS NOT NULL AND emp."id" IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM "employee_loans" WHERE "companyId" = p_company AND "code" = 'DEMO-LN-001') THEN
    loan_id := gen_random_uuid()::TEXT;
    INSERT INTO "employee_loans" ("id", "companyId", "code", "employeeId", "loanTypeId", "loanAmount", "sanctionedAmount",
      "documentDate", "status", "effectiveDate", "noOfInstallments", "amountPerMonth", "approved", "isActive", "updatedAt")
    VALUES (loan_id, p_company, 'DEMO-LN-001', emp."id", lt_pl, 60000, 60000, make_date(yr - 1, 12, 15), 'Open',
      make_date(yr, 1, 25), 12, 5000, true, true, now());
    INSERT INTO "employee_loan_installments" ("id", "loanId", "ordering", "month", "year", "dueDate", "amount", "status")
    SELECT gen_random_uuid()::TEXT, loan_id, i, to_char(make_date(yr, i + 1, 25), 'FMMonth'), yr, make_date(yr, i + 1, 25), 5000, 'Pending'
    FROM generate_series(0, 11) i;
    RETURN NEXT 'created loan DEMO-LN-001 (60,000 over 12 installments) for DEMO-002';
  END IF;

  -- A 20,000 salary advance for DEMO-003, recovered in full by January payroll.
  SELECT * INTO emp FROM "employees" WHERE "companyId" = p_company AND "employeeNumber" = 'DEMO-003';
  IF lt_adv IS NOT NULL AND emp."id" IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM "employee_loans" WHERE "companyId" = p_company AND "code" = 'DEMO-ADV-001') THEN
    loan_id := gen_random_uuid()::TEXT;
    INSERT INTO "employee_loans" ("id", "companyId", "code", "employeeId", "loanTypeId", "loanAmount", "sanctionedAmount",
      "documentDate", "status", "effectiveDate", "noOfInstallments", "amountPerMonth", "approved", "isActive", "updatedAt")
    VALUES (loan_id, p_company, 'DEMO-ADV-001', emp."id", lt_adv, 20000, 20000, make_date(yr, 1, 10), 'Open',
      make_date(yr, 1, 31), 1, 20000, true, true, now());
    INSERT INTO "employee_loan_installments" ("id", "loanId", "ordering", "month", "year", "dueDate", "amount", "status")
    VALUES (gen_random_uuid()::TEXT, loan_id, 0, 'January', yr, make_date(yr, 1, 31), 20000, 'Pending');
    RETURN NEXT 'created salary advance DEMO-ADV-001 (20,000, 1 installment) for DEMO-003';
  END IF;

  -- Two days of approved unpaid leave for DEMO-004 in January → LOP.
  SELECT * INTO emp FROM "employees" WHERE "companyId" = p_company AND "employeeNumber" = 'DEMO-004';
  IF lt_unpaid IS NOT NULL AND emp."id" IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM "leave_requests" WHERE "companyId" = p_company AND "employeeId" = emp."id" AND "reason" = 'Demo unpaid leave') THEN
    INSERT INTO "leave_requests" ("id", "companyId", "employeeId", "leaveTypeId", "startDate", "endDate", "days", "reason",
      "status", "approvedAt", "approvedByName", "updatedAt")
    VALUES (gen_random_uuid()::TEXT, p_company, emp."id", lt_unpaid, make_date(yr, 1, 12), make_date(yr, 1, 13), 2,
      'Demo unpaid leave', 'APPROVED', now(), 'Demo data', now());
    RETURN NEXT 'created 2 days approved unpaid leave for DEMO-004';
  END IF;
END $$ LANGUAGE plpgsql;
