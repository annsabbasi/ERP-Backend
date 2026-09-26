-- Payroll defaults for every company: the masters HR-Payroll's dropdowns read,
-- the payroll G/L accounts, and the account determinations posting needs.
--
-- Why a migration: this changes production data. A script run by hand leaves
-- no reviewable record and cannot be replayed on another environment
-- (see 20260905000000_seed_equity_accounts, same reasoning).
--
-- Why SQL functions: the same defaults must also be created for every company
-- onboarded after today. Rather than keep a TypeScript copy of these rules in
-- the onboarding seeder and hope the two stay in step, the rules live here
-- once, as erp_apply_payroll_defaults(companyId), and DemoDataSeederService
-- calls the same function for each new company. A later change to the
-- defaults is a CREATE OR REPLACE in a new migration, reviewed like this one.
--
-- Idempotent throughout: every insert is guarded (NOT EXISTS / ON CONFLICT DO
-- NOTHING), so a replay — or a company that already has these rows — inserts
-- nothing. Nothing here updates or deletes an existing row.
--
-- What is deliberately NOT here:
--   * Grade pay-scale amounts and tax slabs. Those decide what real employees
--     are paid and taxed; seeding invented figures into a real tenant would
--     make Generate pay people from them. They are in
--     erp_seed_payroll_demo_data(), applied only to companies the owner
--     confirms as demo/test (a later migration).
--   * A chart of accounts, currencies, fiscal periods and numbering for the
--     companies that have none. erp_bootstrap_financials() is defined below
--     but is not called here: which companies get it is the owner's decision.
--   * Payment methods, banks, house bank accounts (Phase 2).

-- ─── Helpers ──────────────────────────────────────────────────────────────────

-- The company's currency if it holds it, else USD, else whatever it has.
-- accounts.currency is a foreign key onto currencies(companyId, code).
CREATE OR REPLACE FUNCTION erp_company_account_currency(p_company TEXT) RETURNS TEXT AS $$
  SELECT COALESCE(
    (SELECT cur."code" FROM "currencies" cur JOIN "companies" c ON c."id" = cur."companyId"
      WHERE cur."companyId" = p_company AND cur."code" = c."currency" LIMIT 1),
    (SELECT cur."code" FROM "currencies" cur WHERE cur."companyId" = p_company AND cur."code" = 'USD' LIMIT 1),
    (SELECT cur."code" FROM "currencies" cur WHERE cur."companyId" = p_company ORDER BY cur."code" LIMIT 1)
  );
$$ LANGUAGE sql STABLE;

-- A free account code in a type's thousand-range: base+100, +200 … then +10 …
-- then +1 …, so a new account lands next to its siblings in either layout.
CREATE OR REPLACE FUNCTION erp_free_account_code(p_company TEXT, p_base INT) RETURNS TEXT AS $$
DECLARE
  step INT;
  k INT;
  candidate TEXT;
BEGIN
  FOREACH step IN ARRAY ARRAY[100, 10, 1] LOOP
    FOR k IN 1..9 LOOP
      candidate := (p_base + step * k)::TEXT;
      IF NOT EXISTS (SELECT 1 FROM "accounts" WHERE "companyId" = p_company AND "code" = candidate) THEN
        RETURN candidate;
      END IF;
    END LOOP;
  END LOOP;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

-- Finds or creates one account and maps it under <area>/<key> (PAYROLL by default).
-- Resolution order (QA B4): existing mapping → subtype → exact name within the
-- type → create. A created account is postable (never a Title account, which
-- AccountDeterminationService.set refuses), sits under the type's top-level
-- Title account when the chart is hierarchical, and at level 1 when it is flat.
CREATE OR REPLACE FUNCTION erp_ensure_mapped_account(
  p_company TEXT, p_key TEXT, p_type "AccountType", p_subtype "AccountSubtype", p_name TEXT, p_base INT,
  p_area "AccountDeterminationArea" DEFAULT 'PAYROLL'
) RETURNS TEXT AS $$
DECLARE
  acct_id TEXT;
  parent RECORD;
  new_code TEXT;
  cur TEXT;
  how TEXT;
BEGIN
  SELECT d."accountId" INTO acct_id FROM "account_determinations" d
  WHERE d."companyId" = p_company AND d."area" = p_area AND d."key" = p_key;
  IF acct_id IS NOT NULL THEN
    RETURN 'kept existing mapping ' || p_area || '/' || p_key;
  END IF;

  SELECT a."id" INTO acct_id FROM "accounts" a
  WHERE a."companyId" = p_company AND a."subtype" = p_subtype AND NOT a."isTitle" AND a."isActive"
  ORDER BY a."code" LIMIT 1;
  how := 'matched by subtype';

  IF acct_id IS NULL THEN
    SELECT a."id" INTO acct_id FROM "accounts" a
    WHERE a."companyId" = p_company AND a."type" = p_type AND lower(a."name") = lower(p_name)
      AND NOT a."isTitle" AND a."isActive"
    ORDER BY a."code" LIMIT 1;
    how := 'matched by name';
  END IF;

  IF acct_id IS NULL THEN
    cur := erp_company_account_currency(p_company);
    IF cur IS NULL THEN
      RETURN 'SKIPPED ' || p_area || '/' || p_key || ': company has no currency master';
    END IF;
    SELECT a."id", a."level" INTO parent FROM "accounts" a
    WHERE a."companyId" = p_company AND a."type" = p_type AND a."isTitle" AND a."parentId" IS NULL
    ORDER BY a."code" LIMIT 1;
    new_code := erp_free_account_code(p_company, p_base);
    IF new_code IS NULL THEN
      RETURN 'SKIPPED ' || p_area || '/' || p_key || ': no free code in the ' || p_base || ' range';
    END IF;
    acct_id := gen_random_uuid()::TEXT;
    INSERT INTO "accounts" (
      "id", "companyId", "code", "name", "type", "subtype", "parentId", "currency",
      "isActive", "isTitle", "isControl", "level", "description", "createdAt", "updatedAt"
    ) VALUES (
      acct_id, p_company, new_code, p_name, p_type, p_subtype, parent."id", cur,
      true, false, false, COALESCE(parent."level", 0) + 1,
      'Created by payroll defaults (20260926020000)', now(), now()
    );
    how := 'created ' || new_code || ' ' || p_name || CASE WHEN parent."id" IS NULL THEN ' (top level)' ELSE ' (under title account)' END;
  ELSE
    -- A matched account without a subtype gets one, so the next lookup is by
    -- what the account is. Only fills a NULL; never overwrites a subtype.
    UPDATE "accounts" SET "subtype" = p_subtype, "updatedAt" = now()
    WHERE "id" = acct_id AND "subtype" IS NULL;
  END IF;

  INSERT INTO "account_determinations" ("id", "companyId", "area", "key", "accountId", "updatedAt")
  VALUES (gen_random_uuid()::TEXT, p_company, p_area, p_key, acct_id, now())
  ON CONFLICT ("companyId", "area", "key") DO NOTHING;

  RETURN how || ' → ' || p_area || '/' || p_key;
END $$ LANGUAGE plpgsql;

-- Maps an existing G/L determination by subtype, only when exactly one
-- postable account carries that subtype (ambiguity is left for a person).
CREATE OR REPLACE FUNCTION erp_map_by_subtype(
  p_company TEXT, p_area "AccountDeterminationArea", p_key TEXT, p_subtype "AccountSubtype"
) RETURNS TEXT AS $$
DECLARE
  n INT;
  acct_id TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM "account_determinations" WHERE "companyId" = p_company AND "area" = p_area AND "key" = p_key) THEN
    RETURN NULL;
  END IF;
  SELECT count(*), min(a."id") INTO n, acct_id FROM "accounts" a
  WHERE a."companyId" = p_company AND a."subtype" = p_subtype AND NOT a."isTitle" AND a."isActive";
  IF n <> 1 THEN
    RETURN CASE WHEN n > 1 THEN 'SKIPPED ' || p_area || '/' || p_key || ': ' || n || ' accounts have subtype ' || p_subtype ELSE NULL END;
  END IF;
  INSERT INTO "account_determinations" ("id", "companyId", "area", "key", "accountId", "updatedAt")
  VALUES (gen_random_uuid()::TEXT, p_company, p_area, p_key, acct_id, now())
  ON CONFLICT ("companyId", "area", "key") DO NOTHING;
  RETURN 'mapped ' || p_area || '/' || p_key;
END $$ LANGUAGE plpgsql;

-- ─── The defaults ─────────────────────────────────────────────────────────────
-- Returns one log line per thing created (or skipped, and why). Called by this
-- migration for every company and by DemoDataSeederService for new ones.
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

-- ─── Defined, not called: owner decisions ────────────────────────────────────

-- The Financials foundation the new-company seeder creates
-- (DemoDataSeederService: currencies, accounts, control accounts, posting
-- periods, numbering series), for a company that never got one. Each part is
-- skipped where the company already has it. Ends by applying the payroll
-- defaults, so the company can post payroll and raise an invoice.
CREATE OR REPLACE FUNCTION erp_bootstrap_financials(p_company TEXT, p_year INT DEFAULT NULL)
RETURNS SETOF TEXT AS $$
DECLARE
  yr INT := COALESCE(p_year, EXTRACT(YEAR FROM now())::INT);
  fy_start INT;
  cur TEXT;
  parent_id TEXT;
  y_from DATE;
  y_to DATE;
  i INT;
  line TEXT;
BEGIN
  INSERT INTO "currencies" ("id", "companyId", "code", "name", "hundredthName", "decimals")
  SELECT gen_random_uuid()::TEXT, p_company, v.code, v.name, v.hund, 2
  FROM (VALUES ('USD', 'US Dollar', 'Cents'), ('EUR', 'Euro', 'Cents'), ('GBP', 'British Pound', 'Pence'),
               ('PKR', 'Pakistani Rupee', 'Paisa')) v(code, name, hund)
  WHERE NOT EXISTS (SELECT 1 FROM "currencies" c WHERE c."companyId" = p_company AND c."code" = v.code);
  IF FOUND THEN RETURN NEXT 'created currency master (USD, EUR, GBP, PKR where missing)'; END IF;

  -- The company's own currency, if it is not one of the four above.
  INSERT INTO "currencies" ("id", "companyId", "code", "name", "decimals")
  SELECT gen_random_uuid()::TEXT, c."id", c."currency", c."currency", 2 FROM "companies" c
  WHERE c."id" = p_company AND c."currency" IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM "currencies" x WHERE x."companyId" = c."id" AND x."code" = c."currency");
  IF FOUND THEN RETURN NEXT 'created currency for the company base currency'; END IF;

  cur := erp_company_account_currency(p_company);

  IF NOT EXISTS (SELECT 1 FROM "accounts" WHERE "companyId" = p_company) THEN
    INSERT INTO "accounts" ("id", "companyId", "code", "name", "type", "currency", "isTitle", "level", "updatedAt")
    SELECT gen_random_uuid()::TEXT, p_company, v.code, v.name, v.type::"AccountType", cur, true, 1, now()
    FROM (VALUES ('1000', 'Assets', 'ASSET'), ('2000', 'Liabilities', 'LIABILITY'), ('3000', 'Equity', 'EQUITY'),
                 ('4000', 'Income', 'INCOME'), ('5000', 'Expenses', 'EXPENSE')) v(code, name, type);
    INSERT INTO "accounts" ("id", "companyId", "code", "name", "type", "subtype", "isControl", "parentId", "currency", "level", "updatedAt")
    SELECT gen_random_uuid()::TEXT, p_company, v.code, v.name, v.type::"AccountType", v.subtype::"AccountSubtype", v.ctl,
      (SELECT a."id" FROM "accounts" a WHERE a."companyId" = p_company AND a."code" = v.parent), cur, 2, now()
    FROM (VALUES
      ('1010', 'Cash on Hand', 'ASSET', 'CASH', false, '1000'),
      ('1020', 'Bank Account', 'ASSET', 'BANK', false, '1000'),
      ('1200', 'Accounts Receivable', 'ASSET', 'ACCOUNTS_RECEIVABLE', true, '1000'),
      ('2100', 'Accounts Payable', 'LIABILITY', 'ACCOUNTS_PAYABLE', true, '2000'),
      ('2200', 'Tax Payable', 'LIABILITY', 'TAX_PAYABLE', false, '2000'),
      ('3100', 'Share Capital', 'EQUITY', 'SHARE_CAPITAL', false, '3000'),
      ('3900', 'Retained Earnings', 'EQUITY', 'RETAINED_EARNINGS', false, '3000'),
      ('4100', 'Sales Revenue', 'INCOME', 'REVENUE', false, '4000'),
      ('5100', 'Cost of Goods Sold', 'EXPENSE', 'COST_OF_GOODS_SOLD', false, '5000'),
      ('5200', 'Operating Expenses', 'EXPENSE', 'OPERATING_EXPENSE', false, '5000')) v(code, name, type, subtype, ctl, parent);
    UPDATE "companies" c SET
      "defaultArAccountId"         = COALESCE(c."defaultArAccountId",         (SELECT a."id" FROM "accounts" a WHERE a."companyId" = c."id" AND a."code" = '1200')),
      "defaultApAccountId"         = COALESCE(c."defaultApAccountId",         (SELECT a."id" FROM "accounts" a WHERE a."companyId" = c."id" AND a."code" = '2100')),
      "defaultCashAccountId"       = COALESCE(c."defaultCashAccountId",       (SELECT a."id" FROM "accounts" a WHERE a."companyId" = c."id" AND a."code" = '1010')),
      "defaultTaxPayableAccountId" = COALESCE(c."defaultTaxPayableAccountId", (SELECT a."id" FROM "accounts" a WHERE a."companyId" = c."id" AND a."code" = '2200')),
      "defaultRevenueAccountId"    = COALESCE(c."defaultRevenueAccountId",    (SELECT a."id" FROM "accounts" a WHERE a."companyId" = c."id" AND a."code" = '4100')),
      "defaultExpenseAccountId"    = COALESCE(c."defaultExpenseAccountId",    (SELECT a."id" FROM "accounts" a WHERE a."companyId" = c."id" AND a."code" = '5200')),
      "updatedAt" = now()
    WHERE c."id" = p_company;
    RETURN NEXT 'created hierarchical chart of accounts (15 accounts) and default control accounts';
  END IF;

  -- One fiscal year with twelve monthly periods, all Open — mirrors
  -- DemoDataSeederService.seedPostingPeriods / FiscalPeriodsService.generate.
  IF NOT EXISTS (SELECT 1 FROM "fiscal_periods" WHERE "companyId" = p_company AND "name" = yr::TEXT) THEN
    SELECT COALESCE("fiscalYearStart", 1) INTO fy_start FROM "companies" WHERE "id" = p_company;
    y_from := make_date(yr, fy_start, 1);
    y_to := (y_from + INTERVAL '1 year' - INTERVAL '1 day')::DATE;
    parent_id := gen_random_uuid()::TEXT;
    INSERT INTO "fiscal_periods" ("id", "companyId", "name", "displayName", "fiscalYear", "subPeriodType",
      "startDate", "endDate", "activeFrom", "activeTo", "updatedAt")
    VALUES (parent_id, p_company, yr::TEXT, 'Fiscal Year ' || yr, yr, 'YEAR', y_from, y_to, y_from, y_to, now());
    FOR i IN 0..11 LOOP
      INSERT INTO "fiscal_periods" ("id", "companyId", "parentId", "name", "displayName", "fiscalYear", "subPeriodType",
        "startDate", "endDate", "activeFrom", "activeTo", "dueDateFrom", "dueDateTo", "updatedAt")
      SELECT gen_random_uuid()::TEXT, p_company, parent_id, yr || '-' || lpad((i + 1)::TEXT, 2, '0'),
        to_char(s, 'FMMonth YYYY'), yr, 'MONTHS', s, e, s, e, s, e, now()
      FROM (SELECT (y_from + make_interval(months => i))::DATE AS s,
                   (y_from + make_interval(months => i + 1) - INTERVAL '1 day')::DATE AS e) x;
    END LOOP;
    RETURN NEXT format('created fiscal year %s with 12 open monthly posting periods', yr);
  END IF;

  INSERT INTO "numbering_series" ("id", "companyId", "documentType", "name", "prefix", "firstNumber", "nextNumber", "digits", "isDefault", "updatedAt")
  SELECT gen_random_uuid()::TEXT, p_company, v.doc, 'Primary', v.prefix, 1, 1, 5, true, now()
  FROM (VALUES ('journal_entry', 'JE-'), ('ar_invoice', 'INV-'), ('ap_bill', 'BILL-'), ('sales_order', 'SO-'),
               ('purchase_order', 'PO-'), ('delivery', 'DL-'), ('incoming_payment', 'RCPT-'),
               ('outgoing_payment', 'PAY-')) v(doc, prefix)
  WHERE NOT EXISTS (SELECT 1 FROM "numbering_series" n WHERE n."companyId" = p_company AND n."documentType" = v.doc);
  IF FOUND THEN RETURN NEXT 'created numbering series where missing (journal_entry, ar_invoice, …)'; END IF;

  FOR line IN SELECT erp_apply_payroll_defaults(p_company, yr) LOOP
    RETURN NEXT line;
  END LOOP;
END $$ LANGUAGE plpgsql;

-- ─── Apply the defaults to every company that exists today ───────────────────
-- Each company's result is logged as a NOTICE (visible in `migrate deploy`
-- output and in the database log) so there is a record of what was created.
DO $$
DECLARE
  co RECORD;
  line TEXT;
BEGIN
  FOR co IN SELECT "id", "name" FROM "companies" ORDER BY "createdAt" LOOP
    FOR line IN SELECT erp_apply_payroll_defaults(co."id", 2026) LOOP
      RAISE NOTICE '[payroll defaults] % : %', co."name", line;
    END LOOP;
  END LOOP;
END $$;
