-- QA D1: company classification.
--
--   Real  — sap-erp-system, DHA-ERP (slug supabase), enterprise system:
--           no demo data, ever. Nothing here touches them.
--   Demo  — ERP Demo Company (demo) and QA Test Co (qa-test-co, once the owner
--           creates it): erp_seed_payroll_demo_data (20260926030000).
--   Test  — everything else: no demo data. The two "Repro Test Co …"
--           companies are deactivated (not deleted — company deletion is
--           blocked by a known approval-template foreign-key bug).
--
-- The demo seed requires erp_apply_payroll_defaults to have run for the
-- company (it uses its categories, departments, pay periods, UNPAID leave type
-- and PL/ADV loan types); it is applied first here, idempotently.
--
-- Idempotent: the demo seed is guarded by code throughout; deactivation only
-- touches active rows. QA Test Co does not exist yet: when it does, re-run
-- `SELECT erp_classify_demo_company('<id>')` from a named migration.

CREATE OR REPLACE FUNCTION erp_classify_demo_company(p_company TEXT) RETURNS SETOF TEXT AS $$
DECLARE
  line TEXT;
  yr INT := EXTRACT(YEAR FROM now())::INT;
BEGIN
  IF EXISTS (SELECT 1 FROM "companies" WHERE "id" = p_company
             AND "slug" IN ('sap-erp-system', 'supabase', 'enterprise-system')) THEN
    RAISE EXCEPTION 'QA D1: % is a real company and must never receive demo data', p_company;
  END IF;
  FOR line IN SELECT erp_apply_payroll_defaults(p_company, yr) LOOP
    RETURN NEXT 'defaults: ' || line;
  END LOOP;
  FOR line IN SELECT erp_seed_payroll_demo_data(p_company, yr) LOOP
    RETURN NEXT 'demo data: ' || line;
  END LOOP;
END $$ LANGUAGE plpgsql;

DO $$
DECLARE
  s_slug TEXT;
  c RECORD;
  line TEXT;
BEGIN
  FOREACH s_slug IN ARRAY ARRAY['demo', 'qa-test-co'] LOOP
    SELECT * INTO c FROM "companies" WHERE "companies"."slug" = s_slug;
    IF c."id" IS NULL THEN
      RAISE NOTICE '[D1] %: no such company here (yet), skipped', s_slug;
      CONTINUE;
    END IF;
    FOR line IN SELECT erp_classify_demo_company(c."id") LOOP
      RAISE NOTICE '[D1] % : %', c."name", line;
    END LOOP;
  END LOOP;

  FOR c IN SELECT * FROM "companies" WHERE "slug" IN ('repro-test-co-1789473107254', 'repro-test-co-1789473413443') LOOP
    IF c."isActive" THEN
      UPDATE "companies" SET "isActive" = false, "updatedAt" = now() WHERE "id" = c."id";
      RAISE NOTICE '[D1] % : deactivated (test company)', c."name";
    ELSE
      RAISE NOTICE '[D1] % : already inactive', c."name";
    END IF;
  END LOOP;
END $$;
