-- ============================================================================
-- F3 — Partner-type enforcement on AR and AP
--
-- customers, vendors and leads share one `business_partners` table
-- discriminated by cardType, so a plain foreign key is satisfied by ANY of
-- them. Nothing prevented raising a customer receivable against a supplier, or
-- an AP bill against a customer. The roadmap never covers discriminated
-- masters, so this gap is invisible to anyone following it.
--
-- Rather than bolt on a second constraint, the existing tenant-scoped key is
-- widened to three columns, so one foreign key now enforces both "same tenant"
-- and "right partner type":
--
--   ar_invoices (companyId, bpId, bpCardType)
--     -> business_partners (companyId, id, cardType)
--
-- The CHECK constraints below pin the stored discriminator, so bpCardType
-- cannot simply be set to whatever makes the FK pass.
--
-- Side effect, and a desirable one: converting a partner from CUSTOMER to
-- VENDOR while they hold invoices is now refused, because the cascade would
-- violate the CHECK.
-- ============================================================================

-- DropForeignKey
ALTER TABLE "ap_bills" DROP CONSTRAINT "ap_bills_companyId_bpId_fkey";

-- DropForeignKey
ALTER TABLE "ar_invoices" DROP CONSTRAINT "ar_invoices_companyId_bpId_fkey";

-- AlterTable
ALTER TABLE "ap_bills" ADD COLUMN     "bpCardType" "BpCardType" NOT NULL;

-- AlterTable
ALTER TABLE "ar_invoices" ADD COLUMN     "bpCardType" "BpCardType" NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "business_partners_companyId_id_cardType_key" ON "business_partners"("companyId", "id", "cardType");

-- AddForeignKey
ALTER TABLE "ar_invoices" ADD CONSTRAINT "ar_invoices_companyId_bpId_bpCardType_fkey" FOREIGN KEY ("companyId", "bpId", "bpCardType") REFERENCES "business_partners"("companyId", "id", "cardType") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_bills" ADD CONSTRAINT "ap_bills_companyId_bpId_bpCardType_fkey" FOREIGN KEY ("companyId", "bpId", "bpCardType") REFERENCES "business_partners"("companyId", "id", "cardType") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Pin the discriminator. Without these, an insert could set bpCardType to
-- 'VENDOR' on an AR invoice and satisfy the foreign key against a vendor.
ALTER TABLE "ar_invoices"
  ADD CONSTRAINT "ar_invoices_bp_must_not_be_vendor"
  CHECK ("bpCardType" <> 'VENDOR');

ALTER TABLE "ap_bills"
  ADD CONSTRAINT "ap_bills_bp_must_be_vendor"
  CHECK ("bpCardType" = 'VENDOR');
