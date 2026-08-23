-- W6 — the user is part of a key's identity.
--
-- Idempotency keys are chosen by clients, not issued by the server, so two
-- users in the same company can pick the same one. Keyed only on
-- (companyId, key, endpoint), the second of them is handed the first's recorded
-- response: a cross-user data leak, and a write silently skipped because
-- somebody else's request happened to share a UUID.
--
-- The table is a cache with a 24-hour expiry, and every row in it is either
-- already answered or belongs to a request currently in flight. Clearing it is
-- therefore safe: the only thing lost is replay protection for requests still
-- running at deploy time, and for payments — the writes where a duplicate
-- actually costs something — the unique index on
-- (companyId, idempotencyKey) refuses the duplicate regardless of what this
-- table remembers. That layering is what makes this migration cheap.
DELETE FROM "idempotency_keys";

ALTER TABLE "idempotency_keys" ADD COLUMN "userId" TEXT NOT NULL;

DROP INDEX "idempotency_keys_companyId_key_endpoint_key";
CREATE UNIQUE INDEX "idempotency_keys_companyId_userId_key_endpoint_key"
  ON "idempotency_keys"("companyId", "userId", "key", "endpoint");
