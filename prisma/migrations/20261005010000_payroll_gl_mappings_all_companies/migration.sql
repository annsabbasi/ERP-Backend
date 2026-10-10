-- Payroll G/L account determinations for every company.
--
-- Post to G/L refused with "No G/L account is mapped for PAYROLL/salary_expense"
-- in every company that had no chart of accounts: erp_apply_payroll_defaults
-- extends an existing chart with the payroll accounts and maps them, and
-- SKIPS a company that has none. Those companies (created through plain
-- POST /companies, or by an onboarding whose account seeding did not run)
-- could run payroll but never post it.
--
-- 20260926020000 left erp_bootstrap_financials() uncalled pending the owner's
-- decision on which companies get it; the owner has now asked for payroll to
-- post in every company, so:
--   * a company with no postable account gets erp_bootstrap_financials — the
--     currency master, a starter chart, the current fiscal year's periods,
--     numbering, and (through erp_apply_payroll_defaults) the payroll
--     accounts and every PAYROLL / AR / AP / cash determination;
--   * every other company gets erp_apply_payroll_defaults again, which maps
--     any PAYROLL key still missing (salary_expense, salaries_payable,
--     tax_payable, loan_receivable, advance_receivable, the deduction keys).
--
-- Both functions only insert what is missing: an account, currency, period or
-- determination a company already has is never changed. Re-running this is a
-- no-op.

DO $$
DECLARE
  c RECORD;
  line TEXT;
BEGIN
  FOR c IN SELECT "id", "slug" FROM "companies" ORDER BY "createdAt" LOOP
    IF NOT EXISTS (SELECT 1 FROM "accounts" WHERE "companyId" = c."id" AND NOT "isTitle") THEN
      FOR line IN SELECT erp_bootstrap_financials(c."id") LOOP
        RAISE NOTICE '% (bootstrap): %', c."slug", line;
      END LOOP;
    ELSE
      FOR line IN SELECT erp_apply_payroll_defaults(c."id") LOOP
        RAISE NOTICE '% (payroll defaults): %', c."slug", line;
      END LOOP;
    END IF;
  END LOOP;
END $$;
