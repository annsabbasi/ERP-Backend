-- QA D5: posting rights in the companies that already exist.
--
--   * financials.accountant (the posting duty set, 20260926040000) is attached
--     to every company's "Company Admin" role — new companies already get it
--     from the onboarding template.
--   * Every company gets an empty "Accountant" role (no permissions yet), for
--     the company to fill and assign through Roles & Permissions.
--
-- A company with no role named "Company Admin" is reported, not guessed at:
-- ERP Demo Company calls its admin role "Admin", and companies created before
-- the template have none. (Reported to QA.)
--
-- Idempotent: ON CONFLICT DO NOTHING / NOT EXISTS on every insert.

DO $$
DECLARE
  c RECORD;
  set_id TEXT;
  admin_id TEXT;
  n INT;
BEGIN
  SELECT "id" INTO set_id FROM "permission_sets" WHERE "key" = 'financials.accountant';
  IF set_id IS NULL THEN
    RAISE EXCEPTION 'QA D5: permission set financials.accountant is missing (20260926040000 not applied?)';
  END IF;

  FOR c IN SELECT "id", "name" FROM "companies" ORDER BY "createdAt" LOOP
    SELECT r."id" INTO admin_id FROM "roles" r WHERE r."companyId" = c."id" AND r."name" = 'Company Admin' ORDER BY r."createdAt" LIMIT 1;
    IF admin_id IS NULL THEN
      RAISE NOTICE '[D5] % : no "Company Admin" role (roles: %) — posting set NOT attached', c."name",
        COALESCE((SELECT string_agg(r."name", ', ' ORDER BY r."name") FROM "roles" r WHERE r."companyId" = c."id"), 'none');
    ELSE
      INSERT INTO "role_permission_sets" ("roleId", "setId") VALUES (admin_id, set_id) ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS n = ROW_COUNT;
      RAISE NOTICE '[D5] % : Company Admin %', c."name", CASE WHEN n > 0 THEN 'given financials.accountant' ELSE 'already has financials.accountant' END;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM "roles" WHERE "companyId" = c."id" AND "name" = 'Accountant') THEN
      INSERT INTO "roles" ("id", "companyId", "name", "description", "updatedAt")
      VALUES (gen_random_uuid()::TEXT, c."id", 'Accountant',
              'Posts journals and payroll runs. Created empty by QA D5 — add its permissions under Roles & Permissions.', now());
      RAISE NOTICE '[D5] % : created empty Accountant role', c."name";
    ELSE
      RAISE NOTICE '[D5] % : Accountant role already exists', c."name";
    END IF;
  END LOOP;
END $$;
