-- Payroll Phase 2, Increment A: banking setup data, employee payment details,
-- and the accounts each payroll deduction type credits.
--
-- Why a migration: this creates rows in every existing company (payment
-- methods, deduction accounts and their G/L mappings). The rules live in SQL
-- functions so onboarding applies exactly the same ones: erp_apply_payroll_defaults
-- (called by DemoDataSeederService and erp_bootstrap_financials) now calls both
-- new functions. Idempotent throughout: guarded inserts only; nothing existing
-- is updated or deleted.

-- ─── 1. Payroll run lines: the per-type split of "Other deductions" ──────────
-- Generate copies each deduction type from the Monthly Adjustment document, so
-- Post can credit every type to its own account. NULL on a row entered by hand
-- (no document): its whole adjustmentDeductions posts as a general deduction.
ALTER TABLE "payroll_run_lines" ADD COLUMN IF NOT EXISTS "adjustmentDeductionSplit" JSONB;
DO $$ BEGIN
  ALTER TABLE "payroll_run_lines" ADD CONSTRAINT "payroll_run_lines_deduction_split_object"
    CHECK ("adjustmentDeductionSplit" IS NULL OR jsonb_typeof("adjustmentDeductionSplit") = 'object');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── 2. Employee payment details ─────────────────────────────────────────────
-- A table of its own, not columns on employees: every generic employee read
-- (lists, pickers, exports) would otherwise carry account numbers. Only the
-- payment-details endpoint reads this table, behind hr.employee_bank.view.
CREATE TABLE IF NOT EXISTS "employee_payment_details" (
  "id"                   TEXT NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "companyId"            TEXT NOT NULL,
  "employeeId"           TEXT NOT NULL,
  "paymentMethodId"      TEXT,
  "bankId"               TEXT,
  "accountTitle"         TEXT,
  "accountNo"            TEXT,
  "iban"                 TEXT,
  -- When the destination of the employee's pay last changed (method, bank,
  -- title, account no. or IBAN). Set by the trigger below, never by the app;
  -- Pay Salaries warns on a recent change (QA R-d).
  "bankDetailsChangedAt" TIMESTAMP(3),
  "updatedById"          TEXT,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "employee_payment_details_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employee_payment_details_iban_format"
    CHECK ("iban" IS NULL OR "iban" ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'),
  CONSTRAINT "employee_payment_details_account_no_format"
    CHECK ("accountNo" IS NULL OR "accountNo" ~ '^[0-9A-Za-z-]{4,34}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS "employee_payment_details_employeeId_key" ON "employee_payment_details" ("employeeId");
CREATE INDEX IF NOT EXISTS "employee_payment_details_companyId_idx" ON "employee_payment_details" ("companyId");
DO $$ BEGIN
  ALTER TABLE "employee_payment_details" ADD CONSTRAINT "employee_payment_details_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "employee_payment_details" ADD CONSTRAINT "employee_payment_details_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "employee_payment_details" ADD CONSTRAINT "employee_payment_details_paymentMethodId_fkey"
    FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "employee_payment_details" ADD CONSTRAINT "employee_payment_details_bankId_fkey"
    FOREIGN KEY ("bankId") REFERENCES "banks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The change history (QA R-d: who, old → new, when). Written by the trigger
-- in the same transaction as the change, so no write path — the API, a script,
-- psql — can change a destination without leaving a row here. Account no. and
-- IBAN are stored masked (last 4 digits), like everywhere they are shown.
CREATE TABLE IF NOT EXISTS "employee_payment_detail_changes" (
  "id"          TEXT NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "companyId"   TEXT NOT NULL,
  "employeeId"  TEXT NOT NULL,
  "field"       TEXT NOT NULL,
  "oldValue"    TEXT,
  "newValue"    TEXT,
  "changedById" TEXT,
  "changedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "employee_payment_detail_changes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "employee_payment_detail_changes_employee_idx"
  ON "employee_payment_detail_changes" ("employeeId", "changedAt");
DO $$ BEGIN
  ALTER TABLE "employee_payment_detail_changes" ADD CONSTRAINT "employee_payment_detail_changes_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "employee_payment_detail_changes" ADD CONSTRAINT "employee_payment_detail_changes_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION erp_mask_tail(v TEXT) RETURNS TEXT AS $$
  SELECT CASE WHEN v IS NULL THEN NULL
              WHEN length(v) <= 4 THEN repeat('*', length(v))
              ELSE repeat('*', length(v) - 4) || right(v, 4) END
$$ LANGUAGE sql IMMUTABLE;

-- Two triggers, not one. Prisma's upsert (and any INSERT … ON CONFLICT DO
-- UPDATE) fires BEFORE INSERT for the attempted insert even when the row then
-- becomes an update, so history written there records a phantom "set from
-- nothing" on every re-save (caught by payroll-phase2a.spec.ts). AFTER
-- triggers fire only for what actually happened.
--
-- BEFORE: tenant consistency, the change stamp, the actor. It must be BEFORE
-- to set NEW's columns; on an insert that turns into an update its NEW is
-- discarded, and the BEFORE UPDATE that follows decides the stamp again.
CREATE OR REPLACE FUNCTION erp_employee_payment_details_guard() RETURNS TRIGGER AS $$
DECLARE
  actor TEXT := NULLIF(current_setting('erp.actor_id', true), '');
  changed BOOLEAN;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "employees" WHERE "id" = NEW."employeeId" AND "companyId" = NEW."companyId") THEN
    RAISE EXCEPTION 'ERP_RULE: the employee does not belong to this company' USING ERRCODE = 'P0001';
  END IF;
  IF NEW."paymentMethodId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "payment_methods" WHERE "id" = NEW."paymentMethodId" AND "companyId" = NEW."companyId" AND "direction" = 'OUTGOING'
  ) THEN
    RAISE EXCEPTION 'ERP_RULE: the payment method must be an outgoing method of this company' USING ERRCODE = 'P0001';
  END IF;
  IF NEW."bankId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "banks" WHERE "id" = NEW."bankId" AND "companyId" = NEW."companyId"
  ) THEN
    RAISE EXCEPTION 'ERP_RULE: the bank does not belong to this company' USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'INSERT' THEN
    changed := NEW."paymentMethodId" IS NOT NULL OR NEW."bankId" IS NOT NULL OR NEW."accountTitle" IS NOT NULL
               OR NEW."accountNo" IS NOT NULL OR NEW."iban" IS NOT NULL;
    NEW."bankDetailsChangedAt" := CASE WHEN changed THEN now() END;
  ELSE
    -- Compared on the real values, not the masks: a new account number that
    -- happens to share the last four digits is still a change.
    changed := OLD."paymentMethodId" IS DISTINCT FROM NEW."paymentMethodId" OR OLD."bankId" IS DISTINCT FROM NEW."bankId"
               OR OLD."accountTitle" IS DISTINCT FROM NEW."accountTitle" OR OLD."accountNo" IS DISTINCT FROM NEW."accountNo"
               OR OLD."iban" IS DISTINCT FROM NEW."iban";
    NEW."bankDetailsChangedAt" := CASE WHEN changed THEN now() ELSE OLD."bankDetailsChangedAt" END;
  END IF;
  NEW."updatedById" := COALESCE(actor, NEW."updatedById");
  NEW."updatedAt" := now();
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS employee_payment_details_guard ON "employee_payment_details";
CREATE TRIGGER employee_payment_details_guard
  BEFORE INSERT OR UPDATE ON "employee_payment_details"
  FOR EACH ROW EXECUTE FUNCTION erp_employee_payment_details_guard();

-- AFTER: one history row per field that changed, masked, in the same
-- transaction as the change.
CREATE OR REPLACE FUNCTION erp_employee_payment_details_history() RETURNS TRIGGER AS $$
DECLARE
  actor TEXT := NULLIF(current_setting('erp.actor_id', true), '');
  old_method TEXT; new_method TEXT; old_bank TEXT; new_bank TEXT;
  is_update BOOLEAN := TG_OP = 'UPDATE';
BEGIN
  SELECT "code" INTO new_method FROM "payment_methods" WHERE "id" = NEW."paymentMethodId";
  SELECT "code" INTO new_bank FROM "banks" WHERE "id" = NEW."bankId";
  IF is_update THEN
    SELECT "code" INTO old_method FROM "payment_methods" WHERE "id" = OLD."paymentMethodId";
    SELECT "code" INTO old_bank FROM "banks" WHERE "id" = OLD."bankId";
  END IF;

  INSERT INTO "employee_payment_detail_changes" ("companyId", "employeeId", "field", "oldValue", "newValue", "changedById")
  SELECT NEW."companyId", NEW."employeeId", c.field, c.old_v, c.new_v, actor
  FROM (VALUES
    ('paymentMethod', old_method, new_method,
       CASE WHEN is_update THEN OLD."paymentMethodId" IS DISTINCT FROM NEW."paymentMethodId" ELSE NEW."paymentMethodId" IS NOT NULL END),
    ('bank', old_bank, new_bank,
       CASE WHEN is_update THEN OLD."bankId" IS DISTINCT FROM NEW."bankId" ELSE NEW."bankId" IS NOT NULL END),
    ('accountTitle', CASE WHEN is_update THEN OLD."accountTitle" END, NEW."accountTitle",
       CASE WHEN is_update THEN OLD."accountTitle" IS DISTINCT FROM NEW."accountTitle" ELSE NEW."accountTitle" IS NOT NULL END),
    ('accountNo', erp_mask_tail(CASE WHEN is_update THEN OLD."accountNo" END), erp_mask_tail(NEW."accountNo"),
       CASE WHEN is_update THEN OLD."accountNo" IS DISTINCT FROM NEW."accountNo" ELSE NEW."accountNo" IS NOT NULL END),
    ('iban', erp_mask_tail(CASE WHEN is_update THEN OLD."iban" END), erp_mask_tail(NEW."iban"),
       CASE WHEN is_update THEN OLD."iban" IS DISTINCT FROM NEW."iban" ELSE NEW."iban" IS NOT NULL END)
  ) c(field, old_v, new_v, differs)
  WHERE c.differs;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS employee_payment_details_history ON "employee_payment_details";
CREATE TRIGGER employee_payment_details_history
  AFTER INSERT OR UPDATE ON "employee_payment_details"
  FOR EACH ROW EXECUTE FUNCTION erp_employee_payment_details_history();

-- The history is append-only. The one delete allowed is the cascade when the
-- employee (or the whole company) is deleted — otherwise company deletion
-- would be blocked, as found in Phase 1.
CREATE OR REPLACE FUNCTION erp_employee_payment_detail_changes_append_only() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM "employees" WHERE "id" = OLD."employeeId") THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'ERP_RULE: payment-detail history cannot be changed or deleted' USING ERRCODE = 'P0001';
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS employee_payment_detail_changes_append_only ON "employee_payment_detail_changes";
CREATE TRIGGER employee_payment_detail_changes_append_only
  BEFORE UPDATE OR DELETE ON "employee_payment_detail_changes"
  FOR EACH ROW EXECUTE FUNCTION erp_employee_payment_detail_changes_append_only();

-- ─── 3. Permissions (QA R-d) ─────────────────────────────────────────────────
-- Global rows only; no existing role receives them. Who may see or change
-- where an employee's pay goes is each tenant's decision (Roles & Permissions).
INSERT INTO "permissions" ("id", "key", "resource", "action", "moduleSlug", "description")
SELECT gen_random_uuid()::TEXT, v.key, 'hr.employee_bank', v.action, 'hr', v.description
FROM (VALUES
  ('hr.employee_bank.view',   'view',   'View employee bank account details (account no. and IBAN in full)'),
  ('hr.employee_bank.update', 'update', 'Change employee payment method and bank account details')
) v(key, action, description)
ON CONFLICT ("key") DO NOTHING;

-- ─── 4. Outgoing payment methods ─────────────────────────────────────────────
-- CASH is the default for an employee with no payment details. A code the
-- company already uses is left alone and reported, never overwritten.
CREATE OR REPLACE FUNCTION erp_apply_payment_methods(p_company TEXT) RETURNS SETOF TEXT AS $$
DECLARE
  v RECORD;
BEGIN
  FOR v IN SELECT * FROM (VALUES
    ('CASH',   'Cash',                     'cash'),
    ('CHQ',    'Cheque',                   'check'),
    ('ONLINE', 'Online transfer',          'online'),
    ('IBFT',   'Inter-bank funds transfer', 'ibft'),
    ('LOAN',   'Settle against loan',      'loan'),
    ('ADV',    'Settle against advance',   'advance')) m(code, descr, means)
  LOOP
    IF EXISTS (SELECT 1 FROM "payment_methods" WHERE "companyId" = p_company AND "code" = v.code) THEN
      IF EXISTS (SELECT 1 FROM "payment_methods" WHERE "companyId" = p_company AND "code" = v.code
                   AND ("direction" <> 'OUTGOING' OR "paymentMeans" IS DISTINCT FROM v.means)) THEN
        RETURN NEXT format('SKIPPED payment method %s: the company already has a different method with that code', v.code);
      END IF;
      CONTINUE;
    END IF;
    INSERT INTO "payment_methods" ("id", "companyId", "code", "description", "direction", "paymentMeans", "isActive")
    VALUES (gen_random_uuid()::TEXT, p_company, v.code, v.descr, 'OUTGOING', v.means, true);
    RETURN NEXT format('created outgoing payment method %s', v.code);
  END LOOP;
END $$ LANGUAGE plpgsql;

-- ─── 5. Deduction accounts ───────────────────────────────────────────────────
-- One PAYROLL mapping key per Monthly Adjustment deduction type, so each is its
-- own JE credit line. The defaults group them onto three accounts (QA's
-- recommendation; the owner's accountant may remap any key in the G/L Account
-- Determination window):
--   mess                       → Mess Expense Recovery (contra-expense)
--   car insurance / laptop 1,2 → Other Income (no receivable: the asset is not sold)
--   general 1,2, deduction 11–15 → Other Deductions Payable
-- The loan deduction column is not here: it credits loan_receivable.
CREATE OR REPLACE FUNCTION erp_apply_payroll_deduction_accounts(p_company TEXT) RETURNS SETOF TEXT AS $$
DECLARE
  v RECORD;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "accounts" WHERE "companyId" = p_company AND NOT "isTitle") THEN
    RETURN NEXT 'SKIPPED deduction accounts: company has no chart of accounts';
    RETURN;
  END IF;
  FOR v IN SELECT * FROM (VALUES
    (1,  'mess_deduction',             'EXPENSE',   'MESS_EXPENSE_RECOVERY',    'Mess Expense Recovery',    5000),
    (2,  'car_ins_laptop_deduction',   'INCOME',    'OTHER_INCOME',             'Other Income',             4000),
    (3,  'car_ins_laptop_deduction_2', 'INCOME',    'OTHER_INCOME',             'Other Income',             4000),
    (4,  'general_deduction',          'LIABILITY', 'OTHER_DEDUCTIONS_PAYABLE', 'Other Deductions Payable', 2000),
    (5,  'general_deduction_2',        'LIABILITY', 'OTHER_DEDUCTIONS_PAYABLE', 'Other Deductions Payable', 2000),
    (6,  'deduction_11',               'LIABILITY', 'OTHER_DEDUCTIONS_PAYABLE', 'Other Deductions Payable', 2000),
    (7,  'deduction_12',               'LIABILITY', 'OTHER_DEDUCTIONS_PAYABLE', 'Other Deductions Payable', 2000),
    (8,  'deduction_13',               'LIABILITY', 'OTHER_DEDUCTIONS_PAYABLE', 'Other Deductions Payable', 2000),
    (9,  'deduction_14',               'LIABILITY', 'OTHER_DEDUCTIONS_PAYABLE', 'Other Deductions Payable', 2000),
    (10, 'deduction_15',               'LIABILITY', 'OTHER_DEDUCTIONS_PAYABLE', 'Other Deductions Payable', 2000)
  ) d(ord, key, typ, sub, name, base) ORDER BY ord
  LOOP
    RETURN NEXT erp_ensure_mapped_account(p_company, v.key, v.typ::"AccountType", v.sub::"AccountSubtype", v.name, v.base);
  END LOOP;
END $$ LANGUAGE plpgsql;

-- ─── 6. erp_apply_payroll_defaults, now including both of the above ──────────
-- The 20260926020000 body unchanged, plus the two calls (marked "Phase 2").
CREATE OR REPLACE FUNCTION erp_apply_payroll_defaults(p_company TEXT, p_year INT DEFAULT NULL)
RETURNS SETOF TEXT AS $$
DECLARE
  yr INT := COALESCE(p_year, EXTRACT(YEAR FROM now())::INT);
  m INT;
  d_from DATE;
  d_to DATE;
  line TEXT;
  n INT;
BEGIN
  -- Employee categories, departments, shifts, positions: only for a company
  -- that has none at all (the seed-hr-dropdowns set).
  IF NOT EXISTS (SELECT 1 FROM "employee_categories" WHERE "companyId" = p_company) THEN
    INSERT INTO "employee_categories" ("id", "companyId", "code", "name", "updatedAt")
    SELECT gen_random_uuid()::TEXT, p_company, v.code, v.name, now()
    FROM (VALUES ('PERM', 'Permanent'), ('CONT', 'Contract'), ('PROB', 'Probation'), ('TEMP', 'Temporary')) v(code, name);
    RETURN NEXT 'created 4 employee categories';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM "departments" WHERE "companyId" = p_company) THEN
    INSERT INTO "departments" ("id", "companyId", "name", "description")
    SELECT gen_random_uuid()::TEXT, p_company, v.name, v.descr
    FROM (VALUES
      ('Human Resources', 'HR & Personnel Administration'),
      ('Finance & Accounts', 'Accounting, Treasury & Financial Reporting'),
      ('Information Technology', 'IT Systems & Support'),
      ('Operations', 'Day-to-day Operations'),
      ('Sales & Marketing', 'Sales, Marketing & Business Development')) v(name, descr);
    RETURN NEXT 'created 5 departments';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM "shifts" WHERE "companyId" = p_company) THEN
    INSERT INTO "shifts" ("id", "companyId", "code", "name", "startTime", "endTime", "isOvernight", "breakMinutes", "workDays", "updatedAt")
    SELECT gen_random_uuid()::TEXT, p_company, v.code, v.name, v.st, v.et, v.ovn, v.brk, ARRAY[1,2,3,4,5], now()
    FROM (VALUES
      ('MORN', 'Morning Shift', '09:00', '17:00', false, 60),
      ('EVE', 'Evening Shift', '14:00', '22:00', false, 45),
      ('NIGHT', 'Night Shift', '22:00', '06:00', true, 45)) v(code, name, st, et, ovn, brk);
    RETURN NEXT 'created 3 shifts';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM "positions" WHERE "companyId" = p_company) THEN
    INSERT INTO "positions" ("id", "companyId", "code", "title", "level", "updatedAt")
    SELECT gen_random_uuid()::TEXT, p_company, v.code, v.title, v.lvl, now()
    FROM (VALUES ('MGR', 'Manager', 3), ('AMGR', 'Assistant Manager', 2), ('SOFF', 'Senior Officer', 2),
                 ('OFF', 'Officer', 1), ('EXEC', 'Executive', 1)) v(code, title, lvl);
    RETURN NEXT 'created 5 positions';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM "branches" WHERE "companyId" = p_company) THEN
    INSERT INTO "branches" ("id", "companyId", "name", "code", "updatedAt")
    VALUES (gen_random_uuid()::TEXT, p_company, 'Head Office', 'HO', now());
    RETURN NEXT 'created branch Head Office';
  END IF;

  -- Monthly pay periods for the year. A month is skipped when the company
  -- already has that code, or a period with exactly that date range, so a
  -- tenant that set up its own months never gets a second copy.
  n := 0;
  FOR m IN 1..12 LOOP
    d_from := make_date(yr, m, 1);
    d_to := (d_from + INTERVAL '1 month' - INTERVAL '1 day')::DATE;
    IF NOT EXISTS (
      SELECT 1 FROM "pay_periods" p WHERE p."companyId" = p_company
        AND (p."code" = format('PP-%s-%s', yr, lpad(m::TEXT, 2, '0'))
             OR (p."fromDate"::DATE = d_from AND p."toDate"::DATE = d_to))
    ) THEN
      INSERT INTO "pay_periods" (
        "id", "companyId", "code", "name", "status", "fromDate", "toDate", "payMonth",
        "workingDays", "saturdays", "holidays", "isActive", "updatedAt"
      )
      SELECT gen_random_uuid()::TEXT, p_company,
        format('PP-%s-%s', yr, lpad(m::TEXT, 2, '0')),
        to_char(d_from, 'FMMonth YYYY'),
        'Open', d_from, d_to, to_char(d_from, 'FMMonth YYYY'),
        (SELECT count(*) FROM generate_series(d_from, d_to, INTERVAL '1 day') g WHERE EXTRACT(ISODOW FROM g) < 6),
        (SELECT count(*) FROM generate_series(d_from, d_to, INTERVAL '1 day') g WHERE EXTRACT(ISODOW FROM g) = 6),
        0, true, now();
      n := n + 1;
    END IF;
  END LOOP;
  IF n > 0 THEN RETURN NEXT format('created %s pay periods for %s', n, yr); END IF;

  -- Leave types. The deduction switch is `paid` (false = docked from salary);
  -- `payableLeave` is a separate display flag and is never used for this.
  IF NOT EXISTS (SELECT 1 FROM "leave_types" WHERE "companyId" = p_company) THEN
    INSERT INTO "leave_types" ("id", "companyId", "code", "name", "paid", "totalLeavesInYear", "leaveCategory", "updatedAt")
    SELECT gen_random_uuid()::TEXT, p_company, v.code, v.name, v.paid, v.days, v.cat, now()
    FROM (VALUES
      ('ANNUAL', 'Annual Leave', true, 14, 'Annual'),
      ('SICK', 'Sick Leave', true, 8, 'Sick'),
      ('CASUAL', 'Casual Leave', true, 10, 'Casual'),
      ('UNPAID', 'Unpaid Leave', false, NULL, 'Others')) v(code, name, paid, days, cat);
    RETURN NEXT 'created 4 leave types (1 unpaid)';
  ELSIF NOT EXISTS (SELECT 1 FROM "leave_types" WHERE "companyId" = p_company AND NOT "paid") THEN
    INSERT INTO "leave_types" ("id", "companyId", "code", "name", "paid", "leaveCategory", "updatedAt")
    SELECT gen_random_uuid()::TEXT, p_company, 'UNPAID', 'Unpaid Leave', false, 'Others', now()
    WHERE NOT EXISTS (SELECT 1 FROM "leave_types" WHERE "companyId" = p_company AND "code" = 'UNPAID');
    IF FOUND THEN RETURN NEXT 'created leave type UNPAID (unpaid)'; END IF;
  END IF;

  -- Loan types: one personal loan and one salary advance, only if the company
  -- has no type of that kind yet.
  IF NOT EXISTS (SELECT 1 FROM "loan_types" WHERE "companyId" = p_company AND lower("loanType") = 'personal') THEN
    INSERT INTO "loan_types" ("id", "companyId", "code", "description", "loanType", "rateOfInterest", "maxInstallments", "updatedAt")
    SELECT gen_random_uuid()::TEXT, p_company, 'PL', 'Personal Loan', 'Personal', 0, 24, now()
    WHERE NOT EXISTS (SELECT 1 FROM "loan_types" WHERE "companyId" = p_company AND "code" = 'PL');
    IF FOUND THEN RETURN NEXT 'created loan type PL Personal Loan'; END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "loan_types" WHERE "companyId" = p_company AND lower("loanType") = 'advance') THEN
    INSERT INTO "loan_types" ("id", "companyId", "code", "description", "loanType", "rateOfInterest", "maxInstallments", "maxNetPayPercent", "allowMultipleOpen", "updatedAt")
    SELECT gen_random_uuid()::TEXT, p_company, 'ADV', 'Salary Advance', 'Advance', 0, 1, 50, false, now()
    WHERE NOT EXISTS (SELECT 1 FROM "loan_types" WHERE "companyId" = p_company AND "code" = 'ADV');
    IF FOUND THEN RETURN NEXT 'created loan type ADV Salary Advance (0%, 1 installment, 50% of net pay)'; END IF;
  END IF;

  -- Grades and a tax formula as structure only — never amounts. A grade
  -- without a pay-scale stage makes Generate name the employee ("No pay scale
  -- for grade G1") instead of paying 0; the formula has no slabs and is
  -- created inactive, so Generate cannot silently compute a zero tax from it.
  IF NOT EXISTS (SELECT 1 FROM "grades" WHERE "companyId" = p_company) THEN
    INSERT INTO "grades" ("id", "companyId", "code", "description", "updatedAt")
    SELECT gen_random_uuid()::TEXT, p_company, v.code, v.descr, now()
    FROM (VALUES ('G1', 'Grade 1 - Junior'), ('G2', 'Grade 2 - Mid'), ('G3', 'Grade 3 - Senior'),
                 ('G4', 'Grade 4 - Management')) v(code, descr);
    RETURN NEXT 'created grades G1-G4 (no pay scale — set amounts under Grade Pay Scale)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "tax_formulas" WHERE "companyId" = p_company) THEN
    INSERT INTO "tax_formulas" ("id", "companyId", "code", "periodYear", "noOfMonths", "remarks", "isActive", "updatedAt")
    VALUES (gen_random_uuid()::TEXT, p_company, 'TX-' || yr, yr, 12,
            'Enter this year''s income-tax slabs, then activate the formula.', false, now());
    RETURN NEXT format('created inactive tax formula TX-%s (no slabs)', yr);
  END IF;

  -- Phase 2: outgoing payment methods (no chart of accounts needed).
  FOR line IN SELECT erp_apply_payment_methods(p_company) LOOP
    RETURN NEXT line;
  END LOOP;

  -- G/L: only for a company that has a chart of accounts to extend.
  IF NOT EXISTS (SELECT 1 FROM "accounts" WHERE "companyId" = p_company AND NOT "isTitle") THEN
    RETURN NEXT 'SKIPPED payroll accounts and mappings: company has no chart of accounts (needs erp_bootstrap_financials)';
    RETURN;
  END IF;

  -- Fixed order, so codes are deterministic for a given chart.
  RETURN NEXT erp_ensure_mapped_account(p_company, 'salary_expense',     'EXPENSE',   'SALARY_EXPENSE',            'Salary Expense',               5000);
  RETURN NEXT erp_ensure_mapped_account(p_company, 'salaries_payable',   'LIABILITY', 'SALARIES_PAYABLE',          'Salaries Payable',             2000);
  -- Withholding tax gets its own account: 2100/2200 "Tax Payable" / "Output
  -- Tax" is the sales-tax account (defaultTaxPayableAccountId), and payroll
  -- withholding must not be mixed into VAT.
  RETURN NEXT erp_ensure_mapped_account(p_company, 'tax_payable',        'LIABILITY', 'WITHHOLDING_TAX_PAYABLE',   'Income Tax Withheld Payable',  2000);
  RETURN NEXT erp_ensure_mapped_account(p_company, 'loan_receivable',    'ASSET',     'EMPLOYEE_LOAN_RECEIVABLE',  'Employee Loan Receivable',     1000);
  RETURN NEXT erp_ensure_mapped_account(p_company, 'advance_receivable', 'ASSET',     'SALARY_ADVANCE_RECEIVABLE', 'Salary Advance Receivable',    1000);

  -- Input tax (recoverable) for A/P. The standard new-company chart never had
  -- one, so an A/P invoice with tax could not post in any freshly onboarded
  -- company. A company that already maps PURCHASING/tax_receivable keeps it.
  RETURN NEXT erp_ensure_mapped_account(p_company, 'tax_receivable', 'ASSET', 'TAX_RECOVERABLE', 'Input Tax Recoverable', 1000, 'PURCHASING');

  -- Phase 2: one credit account per deduction type.
  FOR line IN SELECT erp_apply_payroll_deduction_accounts(p_company) LOOP
    RETURN NEXT line;
  END LOOP;

  -- The non-payroll determinations AR/AP and payments resolve, mapped by
  -- subtype where the chart makes the choice unambiguous (R10: a company able
  -- to post payroll should also be able to raise an invoice).
  FOR line IN
    SELECT erp_map_by_subtype(p_company, v.area::"AccountDeterminationArea", v.key, v.subtype::"AccountSubtype")
    FROM (VALUES
      ('GENERAL', 'cash', 'CASH'),
      ('GENERAL', 'retained_earnings', 'RETAINED_EARNINGS'),
      ('SALES', 'domestic_ar', 'ACCOUNTS_RECEIVABLE'),
      ('SALES', 'revenue', 'REVENUE'),
      ('SALES', 'tax_payable', 'TAX_PAYABLE'),
      ('PURCHASING', 'domestic_ap', 'ACCOUNTS_PAYABLE'),
      ('PURCHASING', 'expense', 'OPERATING_EXPENSE'),
      ('PURCHASING', 'tax_receivable', 'TAX_RECOVERABLE')) v(area, key, subtype)
  LOOP
    IF line IS NOT NULL THEN RETURN NEXT line; END IF;
  END LOOP;
END $$ LANGUAGE plpgsql;

-- ─── 7. Apply to every company that exists today ─────────────────────────────
DO $$
DECLARE
  co RECORD;
  line TEXT;
BEGIN
  FOR co IN SELECT "id", "name" FROM "companies" ORDER BY "createdAt" LOOP
    FOR line IN SELECT erp_apply_payment_methods(co."id") LOOP
      RAISE NOTICE '[payroll phase 2a] % : %', co."name", line;
    END LOOP;
    FOR line IN SELECT erp_apply_payroll_deduction_accounts(co."id") LOOP
      RAISE NOTICE '[payroll phase 2a] % : %', co."name", line;
    END LOOP;
  END LOOP;
END $$;
