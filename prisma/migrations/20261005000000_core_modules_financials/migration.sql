-- Financials is a core module: on for every company, whatever its plan,
-- template or onboarding path.
--
-- Why: payroll (and every other module that books to the G/L) refuses to post
-- when the company has no enabled Financials row, and that row could go
-- missing three ways —
--   * Administration → Modules let an admin switch Financials off (the demo
--     company had exactly that: a row with isEnabled = false);
--   * POST /companies (plain create) wrote a company with no module rows;
--   * an onboarding whose template/plan step did not run left a company with
--     no module rows at all (supabase, enterprise-system, sap-erp-system …).
-- Each left a company that could run payroll but never post it.
--
-- What this does:
--   1. system_modules."isCore" marks a module every company always has.
--      Financials is the only one today; the rule is the flag, not the slug.
--   2. Backfills an enabled row for every (company, core module) pair,
--      re-enabling one that was switched off.
--   3. A trigger on companies enables the core modules for every new company,
--      whichever code path (or script) inserts it.
--   4. A trigger on system_modules enables a module everywhere the moment it
--      becomes core.
--   5. A guard on company_modules refuses disabling or deleting a core
--      module's row. Deleting the company or the module itself still cascades.
--
-- Idempotent: the backfill is an upsert and the functions are CREATE OR
-- REPLACE; the triggers are dropped first.

-- ─── 1. The flag ─────────────────────────────────────────────────────────────

ALTER TABLE "system_modules" ADD COLUMN IF NOT EXISTS "isCore" BOOLEAN NOT NULL DEFAULT false;
UPDATE "system_modules" SET "isCore" = true WHERE "slug" = 'financials';

-- ─── 2/3/4. Enabling ─────────────────────────────────────────────────────────

-- Enables every core module for one company, or (p_company NULL) for all.
CREATE OR REPLACE FUNCTION erp_enable_core_modules(p_company TEXT) RETURNS INTEGER AS $$
DECLARE
  n INTEGER;
BEGIN
  INSERT INTO "company_modules" ("id", "companyId", "moduleId", "isEnabled", "assignedAt")
  SELECT gen_random_uuid()::TEXT, c."id", m."id", true, now()
  FROM "companies" c CROSS JOIN "system_modules" m
  WHERE m."isCore" AND (p_company IS NULL OR c."id" = p_company)
  ON CONFLICT ("companyId", "moduleId") DO UPDATE SET "isEnabled" = true
    WHERE NOT "company_modules"."isEnabled";
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$ LANGUAGE plpgsql;

SELECT erp_enable_core_modules(NULL);

CREATE OR REPLACE FUNCTION erp_company_core_modules_trigger() RETURNS trigger AS $$
BEGIN
  PERFORM erp_enable_core_modules(NEW."id");
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "companies_enable_core_modules" ON "companies";
CREATE TRIGGER "companies_enable_core_modules"
  AFTER INSERT ON "companies"
  FOR EACH ROW EXECUTE FUNCTION erp_company_core_modules_trigger();

CREATE OR REPLACE FUNCTION erp_system_module_core_trigger() RETURNS trigger AS $$
BEGIN
  INSERT INTO "company_modules" ("id", "companyId", "moduleId", "isEnabled", "assignedAt")
  SELECT gen_random_uuid()::TEXT, c."id", NEW."id", true, now()
  FROM "companies" c
  ON CONFLICT ("companyId", "moduleId") DO UPDATE SET "isEnabled" = true
    WHERE NOT "company_modules"."isEnabled";
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "system_modules_enable_core" ON "system_modules";
CREATE TRIGGER "system_modules_enable_core"
  AFTER INSERT OR UPDATE OF "isCore" ON "system_modules"
  FOR EACH ROW WHEN (NEW."isCore")
  EXECUTE FUNCTION erp_system_module_core_trigger();

-- ─── 5. Guard ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION erp_company_module_core_guard() RETURNS trigger AS $$
DECLARE
  mod_name TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT "name" INTO mod_name FROM "system_modules" WHERE "id" = OLD."moduleId" AND "isCore";
    -- A cascade from deleting the company (or the module) runs after the
    -- parent row is gone, so it is let through.
    IF mod_name IS NOT NULL AND EXISTS (SELECT 1 FROM "companies" WHERE "id" = OLD."companyId") THEN
      RAISE EXCEPTION '% is a core module and is always enabled for every company.', mod_name
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF NOT NEW."isEnabled" THEN
    SELECT "name" INTO mod_name FROM "system_modules" WHERE "id" = NEW."moduleId" AND "isCore";
    IF mod_name IS NOT NULL THEN
      RAISE EXCEPTION '% is a core module and is always enabled for every company.', mod_name
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "company_modules_core_guard" ON "company_modules";
CREATE TRIGGER "company_modules_core_guard"
  BEFORE INSERT OR UPDATE OF "isEnabled" OR DELETE ON "company_modules"
  FOR EACH ROW EXECUTE FUNCTION erp_company_module_core_guard();
