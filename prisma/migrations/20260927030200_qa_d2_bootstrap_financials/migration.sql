-- QA D2: the Financials foundation for the 7 companies that have no chart of
-- accounts, so they can post at all (a journal entry needs a posting period,
-- a numbering series, accounts and its currency in the master).
--
-- erp_bootstrap_financials (20260926020000, extended 20260927010000) creates,
-- each only where missing: the currency master, a hierarchical chart with
-- default control accounts, the current fiscal year with 12 open monthly
-- periods, the numbering series — and ends by applying the payroll defaults
-- (erp_apply_payroll_defaults), so the payroll accounts, mappings, deduction
-- accounts and payment methods follow. Runs after D3, so the chart is created
-- in the company's corrected base currency.
--
-- Idempotent: every part of the bootstrap is guarded; a replay creates
-- nothing and logs so. Each line it returns is logged per company.

DO $$
DECLARE
  s_slug TEXT;
  c RECORD;
  line TEXT;
  yr INT := EXTRACT(YEAR FROM now())::INT;
BEGIN
  FOREACH s_slug IN ARRAY ARRAY['sap-erp-system', 'enterprise-system', 'repro-test-co-1789473107254',
                                'repro-test-co-1789473413443', 'company-system', 'supabase', 'mongodb'] LOOP
    SELECT * INTO c FROM "companies" WHERE "companies"."slug" = s_slug;
    IF c."id" IS NULL THEN
      RAISE NOTICE '[D2] %: no such company here, skipped', s_slug;
      CONTINUE;
    END IF;
    FOR line IN SELECT erp_bootstrap_financials(c."id", yr) LOOP
      RAISE NOTICE '[D2] % : %', c."name", line;
    END LOOP;
    RAISE NOTICE '[D2] % : done (% postable accounts, base %)', c."name",
      (SELECT count(*) FROM "accounts" a WHERE a."companyId" = c."id" AND NOT a."isTitle"), c."currency";
  END LOOP;
END $$;
