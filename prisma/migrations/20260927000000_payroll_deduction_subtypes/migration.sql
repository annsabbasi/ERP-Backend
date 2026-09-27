-- Account subtypes for the accounts payroll deductions credit (Phase 2,
-- Increment A: each Monthly Adjustment deduction type gets its own JE line).
--   MESS_EXPENSE_RECOVERY     contra-expense the mess deduction credits
--   OTHER_DEDUCTIONS_PAYABLE  liability for general deductions held for a third party
-- Car/laptop deductions default to the existing OTHER_INCOME subtype.
--
-- A migration of its own: Postgres refuses to use an enum value in the same
-- transaction that added it, and 20260927010000 creates accounts carrying them.
-- IF NOT EXISTS makes a replay a no-op.
ALTER TYPE "AccountSubtype" ADD VALUE IF NOT EXISTS 'MESS_EXPENSE_RECOVERY';
ALTER TYPE "AccountSubtype" ADD VALUE IF NOT EXISTS 'OTHER_DEDUCTIONS_PAYABLE';
