-- Bind the idempotency key to the write it protects, and give replay records
-- an expiry.
--
-- As first built, the key and the payment it guarded were two independent
-- writes in two different transactions. Everything between them was a window:
-- if the process died after the payment committed but before the key was
-- recorded, the key stayed IN_PROGRESS forever and the guarantee was gone.
-- No amount of care in the interceptor closes that window, because the two
-- writes were never atomic with each other.
--
-- The unique index below is what actually makes a payment happen once. A
-- second insert under the same key fails inside the same transaction as the
-- payment, so the whole thing rolls back. The replay record becomes what it
-- should always have been — a cache that returns the original response — while
-- the database enforces the invariant.
--
-- NULLs are distinct in a Postgres unique index, so payments recorded without
-- a key are unaffected: any number of them may coexist.
ALTER TABLE "ar_payments" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "ap_payments" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "ar_payments_companyId_idempotencyKey_key"
  ON "ar_payments"("companyId", "idempotencyKey");
CREATE UNIQUE INDEX "ap_payments_companyId_idempotencyKey_key"
  ON "ap_payments"("companyId", "idempotencyKey");

-- A replay record is a cache, not a permanent fact. Without an expiry the table
-- only grows, and a key could never be reused however long ago its operation
-- passed. Existing rows are given an expiry an hour out rather than being
-- treated as already stale, so anything genuinely in flight during the deploy
-- keeps its protection.
ALTER TABLE "idempotency_keys"
  ADD COLUMN "expiresAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '1 hour');
-- The default existed only to fill the existing rows; new rows set it
-- explicitly from the configured retention.
ALTER TABLE "idempotency_keys" ALTER COLUMN "expiresAt" DROP DEFAULT;

CREATE INDEX "idempotency_keys_expiresAt_idx" ON "idempotency_keys"("expiresAt");
