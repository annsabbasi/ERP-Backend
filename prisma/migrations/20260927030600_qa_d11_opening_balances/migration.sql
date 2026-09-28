-- QA D11: loans and advances that exist before disbursement is recorded in
-- the system (Increment C) never had their receivable debited. Every recovery
-- credits Employee Loan / Salary Advance Receivable, so without an opening
-- balance that account runs negative from the first payroll that recovers one.
--
-- For each company: the loans that are approved, active, and have no
-- disbursement record are marked "disbursed before system"; those with an
-- outstanding balance get ONE opening-balance journal entry for the company —
-- a debit line per loan (its receivable) and one credit to Opening Balance
-- Equity (created where missing, mapped GENERAL/opening_balance).
--
--   outstanding = COALESCE(sanctionedAmount, loanAmount) − active recoveries
--
-- A loan whose installment schedule does not add up to that principal is
-- reported (NOTICE): payroll recovers the schedule, so such a loan would still
-- push the receivable negative until the schedule is corrected (D25, step 4).
--
-- The journal is written by erp_post_journal below, which does in SQL what
-- JournalEntriesService.postFromSource does: an open posting period covering
-- the date, a number from the company's journal_entry numbering series under a
-- row lock, a posted header with its totals, and lines that must balance —
-- checked immediately (SET CONSTRAINTS ALL IMMEDIATE) by the same deferred
-- balance guard every posting passes. The ledger triggers are not disabled.
--
-- Idempotent: a loan once marked is never selected again, so a replay posts
-- nothing. erp_open_loan_balances can be called again (e.g. by Increment C)
-- for loans approved after today and before disbursement exists.

-- ── Loan disbursement record ────────────────────────────────────────────────
ALTER TABLE "employee_loans" ADD COLUMN IF NOT EXISTS "disbursedBeforeSystem" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "employee_loans" ADD COLUMN IF NOT EXISTS "disbursedAt" TIMESTAMP(3);
ALTER TABLE "employee_loans" ADD COLUMN IF NOT EXISTS "disbursementJournalEntryId" TEXT;
DO $$ BEGIN
  ALTER TABLE "employee_loans" ADD CONSTRAINT "employee_loans_disbursementJournalEntryId_fkey"
    FOREIGN KEY ("disbursementJournalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "employee_loans_disbursementJournalEntryId_idx" ON "employee_loans" ("disbursementJournalEntryId");

-- ── A posted journal entry, the way postFromSource writes one ───────────────
-- p_lines: [{ "accountId": …, "debit": n, "credit": n, "description": … }, …]
CREATE OR REPLACE FUNCTION erp_post_journal(
  p_company TEXT, p_date DATE, p_description TEXT, p_reference TEXT,
  p_source TEXT, p_source_id TEXT, p_lines JSONB
) RETURNS TEXT AS $$
DECLARE
  cur TEXT;
  period RECORD;
  series RECORD;
  num TEXT;
  entry_id TEXT := gen_random_uuid()::TEXT;
  dr NUMERIC;
  cr NUMERIC;
  bad TEXT;
BEGIN
  SELECT c."currency" INTO cur FROM "companies" c WHERE c."id" = p_company;
  IF cur IS NULL OR NOT EXISTS (SELECT 1 FROM "currencies" WHERE "companyId" = p_company AND "code" = cur) THEN
    RAISE EXCEPTION 'erp_post_journal: company % has no base currency in its master', p_company;
  END IF;

  SELECT COALESCE(sum((l->>'debit')::NUMERIC), 0), COALESCE(sum((l->>'credit')::NUMERIC), 0) INTO dr, cr
  FROM jsonb_array_elements(p_lines) l;
  IF dr <> cr OR dr <= 0 THEN
    RAISE EXCEPTION 'erp_post_journal: lines do not balance (Dr %, Cr %)', dr, cr;
  END IF;

  -- validateLines: every account is this company's, active and postable.
  SELECT string_agg(l->>'accountId', ', ') INTO bad
  FROM jsonb_array_elements(p_lines) l
  WHERE NOT EXISTS (SELECT 1 FROM "accounts" a WHERE a."id" = l->>'accountId' AND a."companyId" = p_company
                    AND a."isActive" AND NOT a."isTitle");
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'erp_post_journal: not a postable account of this company: %', bad;
  END IF;

  -- resolveOpenPeriod: the sub-period covering the date, open for general postings.
  SELECT fp.* INTO period FROM "fiscal_periods" fp
  WHERE fp."companyId" = p_company AND fp."startDate" <= p_date AND fp."endDate" >= p_date
    AND fp."subPeriodType" <> 'YEAR'
  ORDER BY fp."startDate" DESC LIMIT 1;
  IF period."id" IS NULL THEN
    RAISE EXCEPTION 'erp_post_journal: no posting period covers %', p_date;
  END IF;
  IF period."status" IN ('CLOSED', 'LOCKED') OR period."generalStatus" IN ('CLOSED', 'LOCKED') THEN
    RAISE EXCEPTION 'erp_post_journal: period % is closed for general postings', period."name";
  END IF;

  -- NumberingService.allocate: the default unlocked journal_entry series, under a row lock.
  SELECT ns.* INTO series FROM "numbering_series" ns
  WHERE ns."companyId" = p_company AND ns."documentType" = 'journal_entry' AND NOT ns."isLocked"
  ORDER BY ns."isDefault" DESC, ns."createdAt" ASC LIMIT 1
  FOR UPDATE;
  IF series."id" IS NULL THEN
    RAISE EXCEPTION 'erp_post_journal: no journal_entry numbering series';
  END IF;
  IF series."lastNumber" IS NOT NULL AND series."nextNumber" > series."lastNumber" THEN
    RAISE EXCEPTION 'erp_post_journal: numbering series % is exhausted', series."name";
  END IF;
  UPDATE "numbering_series" SET "nextNumber" = "nextNumber" + 1 WHERE "id" = series."id";
  num := COALESCE(series."prefix", '')
         || CASE WHEN series."digits" > 0 THEN lpad(series."nextNumber"::TEXT, series."digits", '0') ELSE series."nextNumber"::TEXT END
         || COALESCE(series."suffix", '');

  INSERT INTO "journal_entries" ("id", "companyId", "periodId", "number", "seriesId", "date", "docDate",
    "description", "reference", "currency", "source", "sourceId", "status", "postedAt", "totalDebit", "totalCredit",
    "createdAt", "updatedAt")
  VALUES (entry_id, p_company, period."id", num, series."id", p_date, p_date,
    p_description, p_reference, cur, p_source, p_source_id, 'POSTED', now(), dr, cr, now(), now());

  INSERT INTO "journal_lines" ("id", "entryId", "accountId", "debit", "credit", "description", "ordering", "companyId")
  SELECT gen_random_uuid()::TEXT, entry_id, l.v->>'accountId', COALESCE((l.v->>'debit')::NUMERIC, 0),
         COALESCE((l.v->>'credit')::NUMERIC, 0), l.v->>'description', (l.ord - 1)::INT, p_company
  FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS l(v, ord);

  -- The deferred balance guard checks now, not at commit.
  SET CONSTRAINTS ALL IMMEDIATE;
  RETURN entry_id;
END $$ LANGUAGE plpgsql;

-- ── Opening balances for pre-system loans ───────────────────────────────────
CREATE OR REPLACE FUNCTION erp_open_loan_balances(p_company TEXT, p_date DATE DEFAULT CURRENT_DATE)
RETURNS SETOF TEXT AS $$
DECLARE
  l RECORD;
  lines JSONB := '[]'::JSONB;
  total NUMERIC := 0;
  loan_acct TEXT;
  adv_acct TEXT;
  equity_acct TEXT;
  acct TEXT;
  entry_id TEXT;
  loan_ids TEXT[] := ARRAY[]::TEXT[];
  zero_ids TEXT[] := ARRAY[]::TEXT[];
  line TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "employee_loans" el WHERE el."companyId" = p_company AND el."approved" AND el."isActive"
      AND NOT el."disbursedBeforeSystem" AND el."disbursementJournalEntryId" IS NULL
  ) THEN
    RETURN NEXT 'no undisbursed approved loans';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "accounts" WHERE "companyId" = p_company AND NOT "isTitle") THEN
    RETURN NEXT 'SKIPPED: company has no chart of accounts';
    RETURN;
  END IF;

  SELECT d."accountId" INTO loan_acct FROM "account_determinations" d WHERE d."companyId" = p_company AND d."area" = 'PAYROLL' AND d."key" = 'loan_receivable';
  SELECT d."accountId" INTO adv_acct FROM "account_determinations" d WHERE d."companyId" = p_company AND d."area" = 'PAYROLL' AND d."key" = 'advance_receivable';

  FOR l IN
    SELECT el."id", el."code", e."name" AS employee, lt."loanType",
           COALESCE(el."sanctionedAmount", el."loanAmount") AS principal,
           COALESCE((SELECT sum(r."amount") FROM "loan_recoveries" r WHERE r."loanId" = el."id" AND r."reversedAt" IS NULL), 0) AS recovered,
           COALESCE((SELECT sum(i."amount") FROM "employee_loan_installments" i WHERE i."loanId" = el."id"), 0) AS scheduled,
           (SELECT count(*) FROM "employee_loan_installments" i WHERE i."loanId" = el."id") AS n_inst
    FROM "employee_loans" el
    JOIN "employees" e ON e."id" = el."employeeId"
    JOIN "loan_types" lt ON lt."id" = el."loanTypeId"
    WHERE el."companyId" = p_company AND el."approved" AND el."isActive"
      AND NOT el."disbursedBeforeSystem" AND el."disbursementJournalEntryId" IS NULL
    ORDER BY el."code"
  LOOP
    IF l.n_inst > 0 AND round(l.scheduled, 2) <> round(l.principal, 2) THEN
      RETURN NEXT format('WARNING loan %s (%s): its %s installments total %s but the principal is %s — payroll recovers the schedule; correct it before the next Generate (D25)',
        l."code", l.employee, l.n_inst, round(l.scheduled, 2), round(l.principal, 2));
    END IF;
    IF round(l.principal - l.recovered, 2) <= 0 THEN
      zero_ids := zero_ids || l."id";
      RETURN NEXT format('loan %s (%s): fully recovered (%s of %s) — marked disbursed before system, no opening balance',
        l."code", l.employee, round(l.recovered, 2), round(l.principal, 2));
      CONTINUE;
    END IF;
    acct := CASE WHEN lower(l."loanType") = 'advance' THEN adv_acct ELSE loan_acct END;
    IF acct IS NULL THEN
      RETURN NEXT format('SKIPPED loan %s: PAYROLL/%s is not mapped', l."code",
        CASE WHEN lower(l."loanType") = 'advance' THEN 'advance_receivable' ELSE 'loan_receivable' END);
      CONTINUE;
    END IF;
    lines := lines || jsonb_build_object('accountId', acct, 'debit', round(l.principal - l.recovered, 2), 'credit', 0,
      'description', format('Opening balance — %s %s (%s)', CASE WHEN lower(l."loanType") = 'advance' THEN 'advance' ELSE 'loan' END, l."code", l.employee));
    total := total + round(l.principal - l.recovered, 2);
    loan_ids := loan_ids || l."id";
    RETURN NEXT format('loan %s (%s, %s): opening balance %s (principal %s, recovered %s)',
      l."code", l.employee, l."loanType", round(l.principal - l.recovered, 2), round(l.principal, 2), round(l.recovered, 2));
  END LOOP;

  IF array_length(zero_ids, 1) > 0 THEN
    UPDATE "employee_loans" SET "disbursedBeforeSystem" = true, "disbursedAt" = p_date, "updatedAt" = now() WHERE "id" = ANY (zero_ids);
  END IF;
  IF total = 0 THEN
    RETURN;
  END IF;

  FOR line IN SELECT erp_ensure_mapped_account(p_company, 'opening_balance', 'EQUITY', 'OPENING_BALANCE_EQUITY',
                                               'Opening Balance Equity', 3000, 'GENERAL') LOOP
    RETURN NEXT line;
  END LOOP;
  SELECT d."accountId" INTO equity_acct FROM "account_determinations" d WHERE d."companyId" = p_company AND d."area" = 'GENERAL' AND d."key" = 'opening_balance';
  IF equity_acct IS NULL THEN
    RETURN NEXT 'SKIPPED opening balance JE: GENERAL/opening_balance could not be mapped';
    RETURN;
  END IF;
  lines := lines || jsonb_build_object('accountId', equity_acct, 'debit', 0, 'credit', total,
    'description', 'Opening balance — employee loans and advances outstanding at cutover');

  entry_id := erp_post_journal(p_company, p_date, 'Opening balances: employee loans and advances (QA D11)',
                               'QA D11', 'opening_balance', p_company, lines);
  UPDATE "employee_loans" SET "disbursedBeforeSystem" = true, "disbursedAt" = p_date,
         "disbursementJournalEntryId" = entry_id, "updatedAt" = now()
  WHERE "id" = ANY (loan_ids);
  RETURN NEXT format('posted %s: Dr receivables %s / Cr Opening Balance Equity %s (%s loan line(s))',
    (SELECT "number" FROM "journal_entries" WHERE "id" = entry_id), total, total, array_length(loan_ids, 1));
END $$ LANGUAGE plpgsql;

DO $$
DECLARE
  c RECORD;
  line TEXT;
BEGIN
  FOR c IN SELECT "id", "name" FROM "companies" ORDER BY "createdAt" LOOP
    FOR line IN SELECT erp_open_loan_balances(c."id") LOOP
      RAISE NOTICE '[D11] % : %', c."name", line;
    END LOOP;
  END LOOP;
END $$;
