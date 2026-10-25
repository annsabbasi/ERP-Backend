-- ── app_ops: least privilege (QA finding F2, Part 10 §10.5.3) ───────────────────────────
-- app_ops bypasses RLS, so it holds only what today's cross-tenant work uses. The stage that
-- adds a job adds its grants here (provisioning: Stage 5), and the privilege test in
-- packages/db/src/ops.int.test.ts lists them, so a new grant is a visible change.
REVOKE ALL ON ALL TABLES IN SCHEMA "platform", "identity", "app" FROM app_ops;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "platform", "identity", "app" FROM app_ops;

-- Outbox dispatcher (apps/worker): reads the waiting events of every tenant, locks them
-- (FOR UPDATE SKIP LOCKED needs UPDATE on a column) and marks them dispatched.
GRANT SELECT ON "app"."outbox" TO app_ops;
GRANT UPDATE ("dispatched_at", "attempts") ON "app"."outbox" TO app_ops;

-- Owner of platform.append_audit and platform.verify_audit_chain (SECURITY DEFINER): the
-- platform audit log, append-only, and its sequence.
GRANT SELECT, INSERT ON "platform"."platform_audit_log" TO app_ops;
GRANT USAGE ON SEQUENCE "platform"."platform_audit_log_seq_seq" TO app_ops;

-- Owner of identity.invitation_by_token_hash (SECURITY DEFINER, ADR 0006).
GRANT SELECT ON "identity"."invitations" TO app_ops;

-- New tenant tables no longer grant anything to app_ops.
CREATE OR REPLACE FUNCTION "platform"."secure_tenant_tables"() RETURNS integer
LANGUAGE plpgsql AS $fn$
DECLARE
  t record;
  secured integer := 0;
BEGIN
  FOR t IN
    SELECT c.oid::regclass AS rel, c.relname AS name
    FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
    WHERE s.nspname = 'app' AND c.relkind = 'r'
  LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t.rel);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t.rel);
    IF NOT EXISTS (SELECT FROM pg_policies
                   WHERE schemaname = 'app' AND tablename = t.name AND policyname = 'tenant_isolation') THEN
      EXECUTE format($p$CREATE POLICY tenant_isolation ON %s
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)$p$, t.rel);
    END IF;
    IF coalesce(obj_description(t.rel, 'pg_class'), '') LIKE '%@append-only%' THEN
      EXECUTE format('GRANT SELECT, INSERT ON %s TO app_user', t.rel);
      EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %s FROM app_user', t.rel);
    ELSE
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO app_user', t.rel);
    END IF;
    secured := secured + 1;
  END LOOP;
  RETURN secured;
END $fn$;
REVOKE ALL ON FUNCTION "platform"."secure_tenant_tables"() FROM PUBLIC;
