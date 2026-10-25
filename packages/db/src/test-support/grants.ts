import type pg from 'pg';

/**
 * Every privilege a role holds on tables of the three schemas, one line per table and
 * privilege: "app.outbox SELECT", or "app.outbox UPDATE (attempts, dispatched_at)" when the
 * grant is on columns only. The privilege tests compare it with the list they expect.
 */
export async function grantsOf(owner: pg.Client, role: string): Promise<string[]> {
  const { rows } = await owner.query<{ grant: string }>(
    `WITH tables AS (
       SELECT table_schema || '.' || table_name AS t, privilege_type AS p
       FROM information_schema.role_table_grants
       WHERE grantee = $1 AND table_schema IN ('platform', 'identity', 'app')),
     columns AS (
       SELECT table_schema || '.' || table_name AS t, privilege_type AS p,
              string_agg(column_name, ', ' ORDER BY column_name) AS cols
       FROM information_schema.column_privileges
       WHERE grantee = $1 AND table_schema IN ('platform', 'identity', 'app')
       GROUP BY 1, 2)
     SELECT t || ' ' || p AS grant FROM tables
     UNION
     SELECT c.t || ' ' || c.p || ' (' || c.cols || ')' FROM columns c
     WHERE NOT EXISTS (SELECT 1 FROM tables x WHERE x.t = c.t AND x.p = c.p)
     ORDER BY 1`,
    [role],
  );
  return rows.map((r) => r.grant);
}
