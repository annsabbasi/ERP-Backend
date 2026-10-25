import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { LOCAL_HOSTS, hostOf } from './local-only';
import { enableLocalLoginRoles } from './roles';

// Test databases for the integration and isolation tests. Each test suite gets its own
// database, rebuilt from the migrations on every run, on the local Docker Postgres (or the CI
// service container). Nothing here may touch any other host.

export type TestDatabase = {
  name: string;
  /** Owner (superuser) URL: fixtures that need to bypass RLS. */
  ownerUrl: string;
  /** app_user: what the API uses; RLS applies. */
  appUrl: string;
  /** app_ops: BYPASSRLS jobs. */
  opsUrl: string;
  /** app_auth: the auth module; sign-in secrets, no tenant data (ADR 0008). */
  authUrl: string;
};

const DEFAULT_SERVER = 'postgresql://erp:erp@localhost:5433';

function urlFor(server: string, user: string, password: string, database: string): string {
  const u = new URL(server);
  u.username = user;
  u.password = password;
  u.pathname = `/${database}`;
  return u.toString();
}

/**
 * Drops and recreates `name`, applies every migration and enables the login roles.
 * TEST_PG_SERVER (default postgresql://erp:erp@localhost:5433) must be a local superuser.
 */
export async function prepareTestDatabase(name: string): Promise<TestDatabase> {
  if (!/^erp_test_[a-z0-9_]+$/.test(name))
    throw new Error(`test database names start with erp_test_: ${name}`);
  const server = process.env.TEST_PG_SERVER ?? DEFAULT_SERVER;
  if (!LOCAL_HOSTS.has(hostOf(server) ?? ''))
    throw new Error(`TEST_PG_SERVER must be local: ${hostOf(server)}`);
  const owner = new URL(server);
  const db: TestDatabase = {
    name,
    ownerUrl: urlFor(
      server,
      decodeURIComponent(owner.username),
      decodeURIComponent(owner.password),
      name,
    ),
    appUrl: urlFor(
      server,
      'app_user',
      process.env.TEST_APP_USER_PASSWORD ?? 'app_user_local',
      name,
    ),
    opsUrl: urlFor(server, 'app_ops', process.env.TEST_APP_OPS_PASSWORD ?? 'app_ops_local', name),
    authUrl: urlFor(
      server,
      'app_auth',
      process.env.TEST_APP_AUTH_PASSWORD ?? 'app_auth_local',
      name,
    ),
  };

  const admin = new pg.Client({
    connectionString: urlFor(
      server,
      decodeURIComponent(owner.username),
      decodeURIComponent(owner.password),
      'postgres',
    ),
  });
  await admin.connect();
  // Roles are shared by the whole server, and suites prepare their databases in parallel:
  // one at a time, or CREATE/ALTER ROLE collide ("tuple concurrently updated").
  await admin.query('SELECT pg_advisory_lock($1)', [PREPARE_LOCK]);
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${name}"`);
    migrate(db);
    await enableLocalLoginRoles(
      {
        LOCAL_ONLY: '1',
        DATABASE_URL: db.appUrl,
        OPS_DATABASE_URL: db.opsUrl,
        AUTH_DATABASE_URL: db.authUrl,
      },
      db.ownerUrl,
    );
  } finally {
    await admin.query('SELECT pg_advisory_unlock($1)', [PREPARE_LOCK]);
    await admin.end();
  }
  return db;
}

const PREPARE_LOCK = 727_001;

function migrate(db: TestDatabase): void {
  // This file runs from src/ (tests) or dist/ (built); either way the package is one level up.
  const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const prismaCli = createRequire(resolve(packageDir, 'package.json')).resolve(
    'prisma/build/index.js',
  );
  const redis = process.env.REDIS_URL;
  const result = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: packageDir,
    env: {
      ...process.env,
      LOCAL_ONLY: '1',
      DATABASE_URL: `${db.ownerUrl}?schema=platform`,
      DIRECT_URL: `${db.ownerUrl}?schema=platform`,
      OPS_DATABASE_URL: db.opsUrl,
      AUTH_DATABASE_URL: db.authUrl,
      REDIS_URL: redis && LOCAL_HOSTS.has(hostOf(redis) ?? '') ? redis : 'redis://localhost:6381',
    },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`migrate deploy failed for ${db.name}:\n${result.stdout}\n${result.stderr}`);
  }
}

export { createTenantWithData, TENANT_TABLES, type TenantFixture } from './test-support/fixtures';
