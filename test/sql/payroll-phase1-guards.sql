-- Database-level guards added by 20260926010000_payroll_phase1_schema.
--
-- Each block attempts the INVALID operation and passes only if Postgres
-- refuses it (or, for the positive cases, allows it). Runs inside one
-- transaction that is rolled back, so it leaves the database untouched.
-- Run against a disposable copy only:
--   psql -v ON_ERROR_STOP=1 -f test/sql/payroll-phase1-guards.sql
BEGIN;

CREATE TEMP TABLE results (n SERIAL, name TEXT, ok BOOLEAN, detail TEXT);

CREATE FUNCTION pg_temp.expect_error(label TEXT, stmt TEXT) RETURNS void AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
    INSERT INTO results(name, ok, detail) VALUES (label, false, 'statement was accepted');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO results(name, ok, detail) VALUES (label, true, SQLSTATE || ' ' || left(SQLERRM, 110));
  END;
END $$ LANGUAGE plpgsql;

CREATE FUNCTION pg_temp.expect_ok(label TEXT, stmt TEXT) RETURNS void AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
    INSERT INTO results(name, ok, detail) VALUES (label, true, 'accepted');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO results(name, ok, detail) VALUES (label, false, SQLSTATE || ' ' || left(SQLERRM, 110));
  END;
END $$ LANGUAGE plpgsql;

CREATE FUNCTION pg_temp.expect(label TEXT, cond BOOLEAN, detail TEXT) RETURNS void AS $$
  INSERT INTO results(name, ok, detail) VALUES (label, cond, detail);
$$ LANGUAGE sql;

-- Fixture: a company, period, two employees, run A (Regular) holding both.
INSERT INTO companies (id, name, slug, "updatedAt") VALUES ('t-co', 'Guard Test Co', 'guard-test-co', now());
INSERT INTO pay_periods (id, "companyId", code, name, "fromDate", "toDate", "workingDays", "updatedAt")
  VALUES ('t-pp', 't-co', 'T-2026-01', 'Jan 2026', '2026-01-01', '2026-01-31', 22, now());
INSERT INTO employees (id, "companyId", name, "updatedAt") VALUES ('t-e1', 't-co', 'Emp One', now()), ('t-e2', 't-co', 'Emp Two', now());
INSERT INTO payroll_runs (id, "companyId", "payPeriodId", "runType", status, "updatedAt") VALUES ('t-run-a', 't-co', 't-pp', 'Regular', 'Open', now());
INSERT INTO payroll_run_lines (id, "payrollRunId", "employeeId") VALUES ('t-la1', 't-run-a', 't-e1'), ('t-la2', 't-run-a', 't-e2');
INSERT INTO payroll_runs (id, "companyId", "payPeriodId", "runType", status, "updatedAt") VALUES ('t-run-b', 't-co', 't-pp', 'Regular', 'Open', now());

SELECT pg_temp.expect('lines copy company/period/type/active from their run',
  (SELECT bool_and("companyId" = 't-co' AND "payPeriodId" = 't-pp' AND "runType" = 'Regular' AND "runActive") FROM payroll_run_lines WHERE "payrollRunId" = 't-run-a'),
  'mirror columns filled by trigger');

SELECT pg_temp.expect_error('duplicate: same employee in a 2nd active Regular run, same period',
  $q$INSERT INTO payroll_run_lines (id, "payrollRunId", "employeeId") VALUES ('t-lb1', 't-run-b', 't-e1')$q$);

SELECT pg_temp.expect_ok('a Supplementary run may hold the same employee',
  $q$UPDATE payroll_runs SET "runType" = 'Supplementary' WHERE id = 't-run-b';
     INSERT INTO payroll_run_lines (id, "payrollRunId", "employeeId") VALUES ('t-lb1', 't-run-b', 't-e1')$q$);

SELECT pg_temp.expect_error('switching that run back to Regular is refused while run A is active',
  $q$UPDATE payroll_runs SET "runType" = 'Regular' WHERE id = 't-run-b'$q$);

SELECT pg_temp.expect_error('forging runActive=false on an active line is overwritten, so the duplicate still collides',
  $q$UPDATE payroll_run_lines SET "runActive" = false WHERE id = 't-la1';
     UPDATE payroll_runs SET "runType" = 'Regular' WHERE id = 't-run-b'$q$);

SELECT pg_temp.expect_ok('cancelling run A frees its employees',
  $q$UPDATE payroll_runs SET status = 'Cancelled' WHERE id = 't-run-a'$q$);
SELECT pg_temp.expect('cancelled run lines are inactive',
  (SELECT bool_and(NOT "runActive") FROM payroll_run_lines WHERE "payrollRunId" = 't-run-a'), 'runActive=false after cancel');
SELECT pg_temp.expect_ok('...and the other run can now be Regular with the same employee',
  $q$UPDATE payroll_runs SET "runType" = 'Regular' WHERE id = 't-run-b'$q$);

SELECT pg_temp.expect_error('a Regular run without a pay period is refused',
  $q$INSERT INTO payroll_runs (id, "companyId", "runType", status, "updatedAt") VALUES ('t-run-c', 't-co', 'Regular', 'Open', now())$q$);
SELECT pg_temp.expect_ok('an Off-cycle run without a pay period is allowed',
  $q$INSERT INTO payroll_runs (id, "companyId", "runType", status, "updatedAt") VALUES ('t-run-d', 't-co', 'Off-cycle', 'Open', now())$q$);
SELECT pg_temp.expect_error('an unknown run type is refused',
  $q$UPDATE payroll_runs SET "runType" = 'Weekly' WHERE id = 't-run-d'$q$);
SELECT pg_temp.expect_error('an unknown status is refused',
  $q$UPDATE payroll_runs SET status = 'Approved-ish' WHERE id = 't-run-d'$q$);

-- Recovery ledger. One loan type, one loan, one 1000.00 installment.
INSERT INTO loan_types (id, "companyId", code, description, "updatedAt") VALUES ('t-lt', 't-co', 'PL', 'Personal', now());
INSERT INTO employee_loans (id, "companyId", code, "employeeId", "loanTypeId", "loanAmount", status, "updatedAt")
  VALUES ('t-loan', 't-co', 'L-1', 't-e1', 't-lt', 1000, 'Open', now());
INSERT INTO employee_loan_installments (id, "loanId", amount) VALUES ('t-inst', 't-loan', 1000);

SELECT pg_temp.expect_ok('recover half through payroll',
  $q$INSERT INTO loan_recoveries (id, "companyId", "loanId", "installmentId", amount, source, "payrollRunId") VALUES ('t-r1', 't-co', 't-loan', 't-inst', 500, 'payroll', 't-run-b')$q$);
SELECT pg_temp.expect('installment status is derived: Partially Paid',
  (SELECT status = 'Partially Paid' FROM employee_loan_installments WHERE id = 't-inst'), (SELECT status FROM employee_loan_installments WHERE id = 't-inst'));
SELECT pg_temp.expect_error('over-recovery: a payment for the full 1000 when only 500 is outstanding',
  $q$INSERT INTO loan_recoveries (id, "companyId", "loanId", "installmentId", amount, source) VALUES ('t-r2', 't-co', 't-loan', 't-inst', 1000, 'payment')$q$);
SELECT pg_temp.expect_ok('recover the remaining 500 through a payment',
  $q$INSERT INTO loan_recoveries (id, "companyId", "loanId", "installmentId", amount, source) VALUES ('t-r3', 't-co', 't-loan', 't-inst', 500, 'payment')$q$);
SELECT pg_temp.expect('installment Paid and loan Recovered',
  (SELECT i.status = 'Paid' AND l.status = 'Recovered' FROM employee_loan_installments i JOIN employee_loans l ON l.id = i."loanId" WHERE i.id = 't-inst'),
  (SELECT i.status || ' / ' || l.status FROM employee_loan_installments i JOIN employee_loans l ON l.id = i."loanId" WHERE i.id = 't-inst'));
SELECT pg_temp.expect_error('double recovery once the balance is 0 (any amount)',
  $q$INSERT INTO loan_recoveries (id, "companyId", "loanId", "installmentId", amount, source, "payrollRunId") VALUES ('t-r4', 't-co', 't-loan', 't-inst', 0.01, 'payroll', 't-run-b')$q$);
SELECT pg_temp.expect_ok('reverse the payment recovery',
  $q$UPDATE loan_recoveries SET "reversedAt" = now() WHERE id = 't-r3'$q$);
SELECT pg_temp.expect('after reversal: installment back to Partially Paid, loan back to Open',
  (SELECT i.status = 'Partially Paid' AND l.status = 'Open' FROM employee_loan_installments i JOIN employee_loans l ON l.id = i."loanId" WHERE i.id = 't-inst'),
  (SELECT i.status || ' / ' || l.status FROM employee_loan_installments i JOIN employee_loans l ON l.id = i."loanId" WHERE i.id = 't-inst'));
SELECT pg_temp.expect_ok('reverse the payroll recovery',
  $q$UPDATE loan_recoveries SET "reversedAt" = now() WHERE id = 't-r1'$q$);
SELECT pg_temp.expect('balance restored exactly: Pending, 0 active recoveries',
  (SELECT status = 'Pending' FROM employee_loan_installments WHERE id = 't-inst')
    AND (SELECT count(*) = 0 FROM loan_recoveries WHERE "installmentId" = 't-inst' AND "reversedAt" IS NULL),
  (SELECT status FROM employee_loan_installments WHERE id = 't-inst'));
SELECT pg_temp.expect_error('a reversed recovery cannot be reversed again',
  $q$UPDATE loan_recoveries SET "reversedAt" = now() WHERE id = 't-r1'$q$);
SELECT pg_temp.expect_error('a recovery cannot be edited',
  $q$INSERT INTO loan_recoveries (id, "companyId", "loanId", "installmentId", amount, source, "payrollRunId") VALUES ('t-r5', 't-co', 't-loan', 't-inst', 100, 'payroll', 't-run-b');
     UPDATE loan_recoveries SET amount = 1 WHERE id = 't-r5'$q$);
SELECT pg_temp.expect_error('a recovery cannot be deleted',
  $q$INSERT INTO loan_recoveries (id, "companyId", "loanId", "installmentId", amount, source, "payrollRunId") VALUES ('t-r6', 't-co', 't-loan', 't-inst', 100, 'payroll', 't-run-b');
     DELETE FROM loan_recoveries WHERE id = 't-r6'$q$);
SELECT pg_temp.expect_error('installments with recoveries cannot be deleted (regenerating the schedule)',
  $q$INSERT INTO loan_recoveries (id, "companyId", "loanId", "installmentId", amount, source, "payrollRunId") VALUES ('t-r7', 't-co', 't-loan', 't-inst', 100, 'payroll', 't-run-b');
     DELETE FROM employee_loan_installments WHERE "loanId" = 't-loan'$q$);
SELECT pg_temp.expect_error('a recovery must be positive',
  $q$INSERT INTO loan_recoveries (id, "companyId", "loanId", "installmentId", amount, source, "payrollRunId") VALUES ('t-r8', 't-co', 't-loan', 't-inst', 0, 'payroll', 't-run-b')$q$);
SELECT pg_temp.expect_error('a payroll recovery must name its run',
  $q$INSERT INTO loan_recoveries (id, "companyId", "loanId", "installmentId", amount, source) VALUES ('t-r9', 't-co', 't-loan', 't-inst', 10, 'payroll')$q$);
SELECT pg_temp.expect_error('a recovery must reference an installment of its own loan',
  $q$INSERT INTO employee_loans (id, "companyId", code, "employeeId", "loanTypeId", "loanAmount", "updatedAt") VALUES ('t-loan2', 't-co', 'L-2', 't-e2', 't-lt', 50, now());
     INSERT INTO loan_recoveries (id, "companyId", "loanId", "installmentId", amount, source) VALUES ('t-r10', 't-co', 't-loan2', 't-inst', 10, 'payment')$q$);
-- ── Run lock (20260926050000): a non-Open run and its lines are frozen ──────
INSERT INTO currencies (id, "companyId", code, name) VALUES ('t-cur', 't-co', 'PKR', 'Rupee');
INSERT INTO fiscal_periods (id, "companyId", name, "startDate", "endDate", "updatedAt") VALUES ('t-fp', 't-co', 'T-2026-01', '2026-01-01', '2026-01-31', now());
INSERT INTO payroll_runs (id, "companyId", "payPeriodId", "runType", status, "updatedAt") VALUES ('t-run-p', 't-co', 't-pp', 'Supplementary', 'Open', now());
INSERT INTO payroll_run_lines (id, "payrollRunId", "employeeId", basic) VALUES ('t-lp1', 't-run-p', 't-e2', 1000);
SELECT pg_temp.expect_ok('Open → Posted is allowed (and pushes the status to the lines)',
  $q$UPDATE payroll_runs SET status = 'Posted', "jeNo" = 'JE-T1' WHERE id = 't-run-p'$q$);
SELECT pg_temp.expect_error('a posted run: inserting a line is refused',
  $q$INSERT INTO payroll_run_lines (id, "payrollRunId", "employeeId") VALUES ('t-lp2', 't-run-p', 't-e1')$q$);
SELECT pg_temp.expect_error('a posted run: changing a line amount is refused',
  $q$UPDATE payroll_run_lines SET basic = 9999 WHERE id = 't-lp1'$q$);
SELECT pg_temp.expect_error('a posted run: deleting a line is refused',
  $q$DELETE FROM payroll_run_lines WHERE id = 't-lp1'$q$);
SELECT pg_temp.expect_error('a posted run cannot be reopened',
  $q$UPDATE payroll_runs SET status = 'Open' WHERE id = 't-run-p'$q$);
SELECT pg_temp.expect_error('a posted run cannot move to another pay period',
  $q$UPDATE payroll_runs SET "payPeriodId" = NULL WHERE id = 't-run-p'$q$);
SELECT pg_temp.expect_error('a posted run cannot change its JE No',
  $q$UPDATE payroll_runs SET "jeNo" = 'JE-FAKE' WHERE id = 't-run-p'$q$);
SELECT pg_temp.expect_ok('a posted run may still take a remark',
  $q$UPDATE payroll_runs SET remarks = 'checked by finance' WHERE id = 't-run-p'$q$);
SELECT pg_temp.expect_error('a posted run cannot be deleted',
  $q$DELETE FROM payroll_runs WHERE id = 't-run-p'$q$);
SELECT pg_temp.expect_ok('Posted → Cancelled is allowed',
  $q$UPDATE payroll_runs SET status = 'Cancelled', "cancellationJeNo" = 'JE-T2' WHERE id = 't-run-p'$q$);
SELECT pg_temp.expect('the status sync still reached the lines of the locked run',
  (SELECT NOT "runActive" FROM payroll_run_lines WHERE id = 't-lp1'), 'runActive=false after cancel');
SELECT pg_temp.expect_error('a cancelled run cannot change at all',
  $q$UPDATE payroll_runs SET remarks = 'x' WHERE id = 't-run-p'$q$);
SELECT pg_temp.expect_ok('an Open run can still be deleted, lines and all',
  $q$INSERT INTO payroll_runs (id, "companyId", "runType", status, "updatedAt") VALUES ('t-run-o', 't-co', 'Bonus', 'Open', now());
     INSERT INTO payroll_run_lines (id, "payrollRunId", "employeeId") VALUES ('t-lo1', 't-run-o', 't-e1');
     DELETE FROM payroll_runs WHERE id = 't-run-o'$q$);

-- ── One payroll journal entry per run (Q1 backstop) ─────────────────────────
INSERT INTO journal_entries (id, "companyId", "periodId", number, date, currency, source, "sourceId", status, "updatedAt")
  VALUES ('t-je1', 't-co', 't-fp', 'T-JE-1', '2026-01-31', 'PKR', 'payroll_run', 't-run-b', 'DRAFT', now());
SELECT pg_temp.expect_error('a second payroll_run journal entry for the same run is refused',
  $q$INSERT INTO journal_entries (id, "companyId", "periodId", number, date, currency, source, "sourceId", status, "updatedAt")
     VALUES ('t-je2', 't-co', 't-fp', 'T-JE-2', '2026-01-31', 'PKR', 'payroll_run', 't-run-b', 'DRAFT', now())$q$);
SELECT pg_temp.expect_ok('a reversal of that entry (source = reversal) is not blocked by it',
  $q$INSERT INTO journal_entries (id, "companyId", "periodId", number, date, currency, source, "sourceId", status, "updatedAt")
     VALUES ('t-je3', 't-co', 't-fp', 'T-JE-3', '2026-01-31', 'PKR', 'reversal', 't-je1', 'DRAFT', now())$q$);
DELETE FROM journal_entries WHERE "companyId" = 't-co';

SELECT pg_temp.expect_ok('deleting the whole company still works (cascade through the ledger)',
  $q$DELETE FROM companies WHERE id = 't-co'$q$);

SELECT n, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, name, detail FROM results ORDER BY n;
SELECT count(*) FILTER (WHERE ok) AS passed, count(*) FILTER (WHERE NOT ok) AS failed FROM results;
ROLLBACK;
