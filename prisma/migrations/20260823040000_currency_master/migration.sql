-- ============================================================================
-- F10 — Currency becomes a reference, not free text
--
-- Currency was a plain String @default("USD") in 22 places while a `currencies`
-- master table sat empty and unused. Nothing prevented "usd", "US$" and "USD"
-- coexisting, at which point exchange_rates silently fails to match and
-- multi-currency reporting is wrong without ever erroring.
--
-- Section 5 of the roadmap lists Currencies as master data and then never says
-- to reference it — its own golden rule, unapplied in its own example list.
--
-- The master must be populated BEFORE the foreign keys exist, or every row
-- currently carrying "USD" would violate them on creation. Seeded per company
-- below; prisma/seed.ts does the same for new tenants.
-- ============================================================================

-- Seed the currency master for every existing company. ISO-4217 majors plus
-- the regional currencies this deployment actually uses.
INSERT INTO "currencies" ("id","companyId","code","name","intlDescription","hundredthName","decimals","isActive")
SELECT gen_random_uuid(), c.id, v.code, v.name, v.name, v.sub, 2, true
FROM "companies" c
CROSS JOIN (VALUES
  ('USD','US Dollar','Cents'),
  ('EUR','Euro','Cents'),
  ('GBP','Pound Sterling','Pence'),
  ('PKR','Pakistani Rupee','Paisa'),
  ('AED','UAE Dirham','Fils'),
  ('SAR','Saudi Riyal','Halala'),
  ('INR','Indian Rupee','Paise'),
  ('CAD','Canadian Dollar','Cents'),
  ('AUD','Australian Dollar','Cents'),
  ('JPY','Japanese Yen','Sen')
) AS v(code,name,sub)
ON CONFLICT ("companyId","code") DO NOTHING;

-- Any currency already in use that is not in the list above (defensive: keeps
-- the foreign keys addable even if a tenant used something unexpected).
INSERT INTO "currencies" ("id","companyId","code","name","decimals","isActive")
SELECT DISTINCT gen_random_uuid(), t."companyId", t.currency, t.currency, 2, true
FROM (
  SELECT "companyId", currency FROM "ar_invoices"
  UNION SELECT "companyId", currency FROM "ap_bills"
  UNION SELECT "companyId", currency FROM "ar_payments"
  UNION SELECT "companyId", currency FROM "ap_payments"
  UNION SELECT "companyId", currency FROM "business_partners"
  UNION SELECT "companyId", currency FROM "journal_entries"
  UNION SELECT "companyId", currency FROM "accounts"
) t
ON CONFLICT ("companyId","code") DO NOTHING;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_companyId_currency_fkey" FOREIGN KEY ("companyId", "currency") REFERENCES "currencies"("companyId", "code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_companyId_currency_fkey" FOREIGN KEY ("companyId", "currency") REFERENCES "currencies"("companyId", "code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_invoices" ADD CONSTRAINT "ar_invoices_companyId_currency_fkey" FOREIGN KEY ("companyId", "currency") REFERENCES "currencies"("companyId", "code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_payments" ADD CONSTRAINT "ar_payments_companyId_currency_fkey" FOREIGN KEY ("companyId", "currency") REFERENCES "currencies"("companyId", "code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_bills" ADD CONSTRAINT "ap_bills_companyId_currency_fkey" FOREIGN KEY ("companyId", "currency") REFERENCES "currencies"("companyId", "code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_payments" ADD CONSTRAINT "ap_payments_companyId_currency_fkey" FOREIGN KEY ("companyId", "currency") REFERENCES "currencies"("companyId", "code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_partners" ADD CONSTRAINT "business_partners_companyId_currency_fkey" FOREIGN KEY ("companyId", "currency") REFERENCES "currencies"("companyId", "code") ON DELETE RESTRICT ON UPDATE CASCADE;

