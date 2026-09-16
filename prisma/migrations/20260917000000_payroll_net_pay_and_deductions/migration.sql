-- Payroll Process previously stored only earnings components (basic, hra,
-- conveyance, …) and had nowhere to record what was taken off them, so a run
-- could never produce a payable amount. These columns hold the computed
-- payslip: the per-day rate the period was costed at, the paid/unpaid leave
-- split behind the LOP deduction, each deduction source, and the net pay.
--
-- All nullable with no default: existing runs keep NULL, which the windows
-- render as "—" rather than as a real zero-rupee payslip. Re-running Generate
-- on an old run fills them in.
ALTER TABLE "payroll_run_lines"
  ADD COLUMN "grossPay"             DECIMAL(19,4),
  ADD COLUMN "perDayRate"           DECIMAL(19,4),
  ADD COLUMN "paidLeaveDays"        DECIMAL(19,4),
  ADD COLUMN "unpaidLeaveDays"      DECIMAL(19,4),
  ADD COLUMN "lopDeduction"         DECIMAL(19,4),
  ADD COLUMN "loanDeduction"        DECIMAL(19,4),
  ADD COLUMN "taxableGross"         DECIMAL(19,4),
  ADD COLUMN "taxDeduction"         DECIMAL(19,4),
  ADD COLUMN "adjustmentAdditions"  DECIMAL(19,4),
  ADD COLUMN "adjustmentDeductions" DECIMAL(19,4),
  ADD COLUMN "totalEarnings"        DECIMAL(19,4),
  ADD COLUMN "totalDeductions"      DECIMAL(19,4),
  ADD COLUMN "netPay"               DECIMAL(19,4);

-- Generate reads installments by dueDate to decide what falls in a pay period;
-- without this it is a sequential scan of the whole schedule table per run.
CREATE INDEX IF NOT EXISTS "employee_loan_installments_dueDate_idx"
  ON "employee_loan_installments" ("dueDate");

-- Leave-driven LOP means every payroll run now filters leave by company,
-- status and date range.
CREATE INDEX IF NOT EXISTS "leave_requests_company_status_dates_idx"
  ON "leave_requests" ("companyId", "status", "startDate", "endDate");
