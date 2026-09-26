-- Account subtypes for the payroll accounts, so payroll defaults can find a
-- company's existing Salary Expense / Salaries Payable / withholding / loan /
-- advance accounts again by what they ARE, not by what someone named them.
--
-- A migration of its own on purpose: Postgres refuses to use an enum value in
-- the same transaction that added it, and the payroll defaults backfill that
-- follows inserts accounts carrying these values.
--
-- IF NOT EXISTS makes a replay (or a database fixed by hand) a no-op.
ALTER TYPE "AccountSubtype" ADD VALUE IF NOT EXISTS 'SALARY_EXPENSE';
ALTER TYPE "AccountSubtype" ADD VALUE IF NOT EXISTS 'SALARIES_PAYABLE';
ALTER TYPE "AccountSubtype" ADD VALUE IF NOT EXISTS 'WITHHOLDING_TAX_PAYABLE';
ALTER TYPE "AccountSubtype" ADD VALUE IF NOT EXISTS 'EMPLOYEE_LOAN_RECEIVABLE';
ALTER TYPE "AccountSubtype" ADD VALUE IF NOT EXISTS 'SALARY_ADVANCE_RECEIVABLE';
