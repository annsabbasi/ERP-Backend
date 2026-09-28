-- QA D45 (live defect): the pay scale's utility, medical and two ad-hoc
-- allowances were part of the gross that sets the per-day LOP rate and the
-- taxable gross (grossFromStage), but had no grid column and were not in the
-- gross that is paid (rowTotals) — employees were docked and taxed on money
-- they never received. They become paid grid columns that Generate fills from
-- the pay scale.
--
-- Existing lines keep NULL: a run generated before this pays exactly what it
-- did (posted runs are immutable anyway); Generate again to include them.
-- Idempotent (IF NOT EXISTS).
ALTER TABLE "payroll_run_lines" ADD COLUMN IF NOT EXISTS "utilityAllowance" DECIMAL(19,4);
ALTER TABLE "payroll_run_lines" ADD COLUMN IF NOT EXISTS "medicalAllowance" DECIMAL(19,4);
ALTER TABLE "payroll_run_lines" ADD COLUMN IF NOT EXISTS "adhoc2017" DECIMAL(19,4);
ALTER TABLE "payroll_run_lines" ADD COLUMN IF NOT EXISTS "adhoc2018" DECIMAL(19,4);
