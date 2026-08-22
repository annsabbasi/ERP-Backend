-- Line sequence on A/R invoices and A/P bills.
--
-- Both line tables stored their rows with nothing to order them by, so an
-- invoice would render its lines in whatever order the planner happened to
-- return — and that order can change between two reads of the same document.
-- Line order is part of what the customer was sent, so it belongs in the row.
--
-- Existing rows all take 0, which leaves them grouped but unordered among
-- themselves. There is nothing to recover the original sequence from, and the
-- live tables are empty, so no backfill is possible or needed.
ALTER TABLE "ar_invoice_lines" ADD COLUMN "ordering" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ap_bill_lines"    ADD COLUMN "ordering" INTEGER NOT NULL DEFAULT 0;
