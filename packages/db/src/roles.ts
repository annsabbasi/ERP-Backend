import pg from 'pg';
import { assertLocalOnly, isLocalOnly } from './local-only';

/** The login roles the application connects as, and the URL that carries each password. */
export const LOGIN_ROLES = [
  { role: 'app_user', url: 'DATABASE_URL' },
  { role: 'app_ops', url: 'OPS_DATABASE_URL' },
] as const;

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Local and CI only: lets app_user and app_ops sign in, with the passwords written in their
 * own connection URLs, so each password lives in one place (.env). Hosted databases set
 * these passwords by hand at go-live (ADR 0007); this refuses to run without LOCAL_ONLY.
 */
export async function enableLocalLoginRoles(
  env: Env,
  adminUrl: string | undefined = env.DIRECT_URL,
): Promise<string[]> {
  if (!isLocalOnly(env)) throw new Error('db:local-roles runs only with LOCAL_ONLY=1');
  assertLocalOnly({ ...env, DIRECT_URL: adminUrl }, 'db:local-roles');
  if (!adminUrl) throw new Error('db:local-roles needs DIRECT_URL (the database owner)');
  const admin = new pg.Client({ connectionString: withoutSchema(adminUrl) });
  await admin.connect();
  const done: string[] = [];
  try {
    for (const { role, url } of LOGIN_ROLES) {
      const value = env[url];
      if (!value) continue;
      const parsed = new URL(value);
      if (decodeURIComponent(parsed.username) !== role) {
        throw new Error(`${url} must connect as ${role}, not "${parsed.username}"`);
      }
      const password = decodeURIComponent(parsed.password);
      if (!password) throw new Error(`${url} has no password`);
      const { rows } = await admin.query<{ sql: string }>(
        'SELECT format($$ALTER ROLE %I LOGIN PASSWORD %L$$, $1::text, $2::text) AS sql',
        [role, password],
      );
      await admin.query(rows[0]!.sql);
      done.push(role);
    }
  } finally {
    await admin.end();
  }
  return done;
}

/** Drops Prisma's `schema` parameter, which node-postgres does not understand. */
export function withoutSchema(url: string): string {
  const u = new URL(url);
  u.searchParams.delete('schema');
  return u.toString();
}
