-- ============================================================================
-- Data repair following F5 — plan prices
--
-- The money migration changed plans.monthlyPrice / annualPrice from Int to
-- Decimal(19,4). ALTER COLUMN TYPE preserves the number, so a row holding 4900
-- (meaning 49.00 in cents) silently came to mean 4,900.00.
--
-- Every other converted table was empty and therefore unaffected. `plans` was
-- the one with real rows, and it was missed. This is that repair.
--
-- The four platform plans have known list prices, so they are set explicitly
-- rather than divided by a heuristic — re-running this is a no-op, and it
-- cannot corrupt a value that was already correct.
-- ============================================================================

UPDATE "plans" SET "monthlyPrice" =   49.00, "annualPrice" =  490.00 WHERE "key" = 'starter';
UPDATE "plans" SET "monthlyPrice" =  149.00, "annualPrice" = 1490.00 WHERE "key" = 'business';
UPDATE "plans" SET "monthlyPrice" =  399.00, "annualPrice" = 3990.00 WHERE "key" = 'premium';
-- 'enterprise' is custom-quoted; both prices stay NULL.
