-- Give every existing company the equity accounts Period-End Closing needs.
--
-- The seed now creates 3000 Share Capital and 3200 Retained Earnings, but a
-- seed only helps a company that has not been created yet. Every tenant that
-- already existed had no EQUITY account at all, so the Retained Earnings picker
-- in Period-End Closing came up empty and the feature could not be used.
--
-- This exists as a migration rather than a one-off script because it is a
-- change to production data. A script run by hand leaves no reviewable record,
-- cannot be replayed on another environment, and gives the next person no way
-- to tell what happened or when. A migration is all three.
--
-- Idempotent throughout: every insert is guarded by NOT EXISTS, so it is a
-- no-op on a database that already has these rows -- including the one where
-- this change was first applied by hand.

-- --- EQUITY ACCOUNTS ---------------------------------------------------------
-- `accounts` carries a composite foreign key (companyId, currency) into
-- `currencies`, so the currency has to be one the company actually holds.
-- Preference order: the company's own currency, then USD, then whatever it has.
-- A company with no currency master at all is skipped rather than failed - it
-- cannot post anything yet either way.
INSERT INTO "accounts" (
  "id", "companyId", "code", "name", "type", "currency",
  "isActive", "isTitle", "isControl", "level", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(),
  c."id",
  v."code",
  v."name",
  'EQUITY'::"AccountType",
  COALESCE(
    (SELECT cur."code" FROM "currencies" cur
      WHERE cur."companyId" = c."id" AND cur."code" = c."currency" LIMIT 1),
    (SELECT cur."code" FROM "currencies" cur
      WHERE cur."companyId" = c."id" AND cur."code" = 'USD' LIMIT 1),
    (SELECT cur."code" FROM "currencies" cur
      WHERE cur."companyId" = c."id" ORDER BY cur."code" LIMIT 1)
  ),
  true, false, false, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "companies" c
CROSS JOIN (VALUES
  ('3000', 'Share Capital'),
  ('3200', 'Retained Earnings')
) AS v("code", "name")
WHERE NOT EXISTS (
  SELECT 1 FROM "accounts" a
   WHERE a."companyId" = c."id" AND a."code" = v."code"
)
AND EXISTS (
  SELECT 1 FROM "currencies" cur WHERE cur."companyId" = c."id"
);

-- --- DETERMINATION -----------------------------------------------------------
-- Period-End Closing resolves its target through the determination table like
-- every other posting target, so a company can repoint it without the closing
-- routine hard-coding an account code.
INSERT INTO "account_determinations" (
  "id", "companyId", "area", "key", "accountId", "updatedAt"
)
SELECT
  gen_random_uuid(),
  a."companyId",
  'GENERAL'::"AccountDeterminationArea",
  'retained_earnings',
  a."id",
  CURRENT_TIMESTAMP
FROM "accounts" a
WHERE a."code" = '3200'
  AND NOT EXISTS (
    SELECT 1 FROM "account_determinations" d
     WHERE d."companyId" = a."companyId"
       AND d."area" = 'GENERAL'::"AccountDeterminationArea"
       AND d."key" = 'retained_earnings'
  );
