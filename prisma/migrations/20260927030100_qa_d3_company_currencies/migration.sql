-- QA D3: company base currencies.
--
--   ERP Demo Company (demo)          → USD. It already has posted entries in USD;
--                                      the base was NULL, so this names what the
--                                      ledger already is. Never PKR.
--   The 9 PK test companies          → PKR, adding the PKR master row where
--                                      missing. Only while the company has no
--                                      posted journal entry.
--   sap-erp-system, enterprise-system,
--   DHA-ERP (slug supabase)          → add the PKR master row (base already PKR).
--   Repro Test Co ×2                 → unchanged.
--
-- The 9 test companies' charts were created while their base was USD, so their
-- accounts carry currency USD. Nothing posts in a foreign-currency account
-- (no posting routine reads accounts.currency), so under a PKR base they would
-- only be mislabelled; while the company has no posting, those accounts are
-- relabelled PKR in the same step. (An extension of D3, reported to QA.)
--
-- Companies are named by slug; a slug that does not exist (another database)
-- is reported and skipped. Idempotent: every change is guarded by the state it
-- changes, so a replay does nothing.

CREATE OR REPLACE FUNCTION erp_ensure_currency(p_company TEXT, p_code TEXT, p_name TEXT, p_hundredth TEXT) RETURNS BOOLEAN AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "currencies" WHERE "companyId" = p_company AND "code" = p_code) THEN
    RETURN false;
  END IF;
  INSERT INTO "currencies" ("id", "companyId", "code", "name", "hundredthName", "decimals")
  VALUES (gen_random_uuid()::TEXT, p_company, p_code, p_name, p_hundredth, 2);
  RETURN true;
END $$ LANGUAGE plpgsql;

DO $$
DECLARE
  c RECORD;
  s_slug TEXT;
  posted INT;
  n INT;
BEGIN
  -- ERP Demo Company → USD.
  SELECT * INTO c FROM "companies" WHERE "slug" = 'demo';
  IF c."id" IS NULL THEN
    RAISE NOTICE '[D3] demo: no such company here, skipped';
  ELSIF c."currency" IS NULL THEN
    PERFORM erp_ensure_currency(c."id", 'USD', 'US Dollar', 'Cents');
    UPDATE "companies" SET "currency" = 'USD', "updatedAt" = now() WHERE "id" = c."id";
    RAISE NOTICE '[D3] % : base currency NULL -> USD (matches its posted entries)', c."name";
  ELSE
    RAISE NOTICE '[D3] % : base currency already %, unchanged', c."name", c."currency";
  END IF;

  -- The 9 PK test companies → PKR, only with zero postings.
  FOREACH s_slug IN ARRAY ARRAY['company-system', 'hanadb', 'mongodb', 'sql', 'rozo', 'firebase', 'nativebase', 'fb', 'nonsql'] LOOP
    SELECT * INTO c FROM "companies" WHERE "companies"."slug" = s_slug;
    IF c."id" IS NULL THEN
      RAISE NOTICE '[D3] %: no such company here, skipped', s_slug;
      CONTINUE;
    END IF;
    SELECT count(*) INTO posted FROM "journal_entries" WHERE "companyId" = c."id" AND "status" <> 'DRAFT';
    IF erp_ensure_currency(c."id", 'PKR', 'Pakistani Rupee', 'Paisa') THEN
      RAISE NOTICE '[D3] % : added PKR to the currency master', c."name";
    END IF;
    IF c."currency" = 'PKR' THEN
      RAISE NOTICE '[D3] % : base currency already PKR', c."name";
    ELSIF posted > 0 THEN
      RAISE NOTICE '[D3] % : NOT changed — % posted journal entr(ies) in %', c."name", posted, c."currency";
      CONTINUE;
    ELSE
      UPDATE "companies" SET "currency" = 'PKR', "updatedAt" = now() WHERE "id" = c."id";
      RAISE NOTICE '[D3] % : base currency % -> PKR', c."name", COALESCE(c."currency", 'NULL');
    END IF;
    IF posted = 0 THEN
      UPDATE "accounts" SET "currency" = 'PKR', "updatedAt" = now()
      WHERE "companyId" = c."id" AND "currency" = 'USD';
      GET DIAGNOSTICS n = ROW_COUNT;
      IF n > 0 THEN RAISE NOTICE '[D3] % : relabelled % account(s) USD -> PKR (no postings)', c."name", n; END IF;
    END IF;
  END LOOP;

  -- Base already PKR; the master row was missing.
  FOREACH s_slug IN ARRAY ARRAY['sap-erp-system', 'enterprise-system', 'supabase'] LOOP
    SELECT * INTO c FROM "companies" WHERE "companies"."slug" = s_slug;
    IF c."id" IS NULL THEN
      RAISE NOTICE '[D3] %: no such company here, skipped', s_slug;
    ELSIF erp_ensure_currency(c."id", 'PKR', 'Pakistani Rupee', 'Paisa') THEN
      RAISE NOTICE '[D3] % : added PKR to the currency master', c."name";
    ELSE
      RAISE NOTICE '[D3] % : PKR already in the master', c."name";
    END IF;
  END LOOP;
END $$;
