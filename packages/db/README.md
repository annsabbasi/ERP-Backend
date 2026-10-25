# @erp/db

Prisma schema, migrations, the database client and the tenant context. The new build uses only the
schemas `platform` (control plane and catalogue), `identity` (people, sign-in) and `app` (company
data); migration history is kept in `platform._prisma_migrations` (`schema=platform` in the
connection URLs). Schema `public` is never used.

| Script              | Use                                                                         |
| ------------------- | --------------------------------------------------------------------------- |
| `db:validate`       | check the schema                                                            |
| `db:generate`       | generate the client into `src/generated/` (not committed)                   |
| `db:migrate:dev`    | create and apply migrations — **local database only**                       |
| `db:migrate:deploy` | apply committed migrations — the only command allowed on hosted databases   |
| `db:local-roles`    | give the local `app_user` and `app_ops` roles a login (local database only) |
| `db:seed`           | load the module, feature and permission catalogue from `@erp/contracts`     |
| `test`              | unit and database tests; needs the local Docker Postgres (`pnpm local:up`)  |

`prisma.config.ts` refuses `migrate dev`, `migrate reset` and `db push` unless the database host is
`localhost`, and with `LOCAL_ONLY=1` refuses every command when a URL is not local (ADR 0007). It
runs before every Prisma command, including direct `prisma …` calls.

## Roles (Part 10 §10.5.3)

| Role           | Connection URL     | Used by                                       | Row-level security      |
| -------------- | ------------------ | --------------------------------------------- | ----------------------- |
| `app_user`     | `DATABASE_URL`     | the API, and the worker's event handlers      | applies; no `BYPASSRLS` |
| `app_ops`      | `OPS_DATABASE_URL` | the worker's cross-tenant jobs (outbox)       | `BYPASSRLS`             |
| `app_migrator` | `DIRECT_URL`       | migrations (locally the `erp` superuser runs) | owner of the tables     |

The migration creates the roles without a login. Hosted environments give them passwords in the
provider's console; locally `db:local-roles` sets the passwords of the URLs in `.env`.

## Tenant data

Every `app.*` table, and `identity.invitations`, has `tenant_id`, RLS enabled and forced, and the
policy `tenant_isolation` (`tenant_id = current_setting('app.tenant_id')`). With no tenant set, a
query sees no rows.

- **In code**, reach tenant data only through `withTenant(client, tenantId, tx => …)`. It opens a
  transaction whose first statement is `set_config('app.tenant_id', …, true)`, so the setting ends
  with the transaction and cannot leak to the next user of a pooled connection. The client from
  `extendForTenants` also adds `tenantId` to every query and refuses tenant models outside
  `withTenant`.
- **In migrations**, a new tenant-owned table ends with `SELECT platform.secure_tenant_tables();`,
  which enables and forces RLS, creates the policy and grants `app_user` its rights. Tables marked
  `@append-only` in their comment get `SELECT` and `INSERT` only. Add the model to `TENANT_MODELS`
  (`src/tenant.ts`) and the table to `TENANT_TABLES` (`src/test-support/fixtures.ts`); the
  isolation suite fails until both are done.
- **Events** go to `app.outbox` with `addOutboxEvent(tx, …)` in the same transaction as the change.
  Consumers wrap their work in `runOnce(tx, consumer, eventId, …)` so a repeated delivery is
  skipped.
- **Before a tenant is known** (invitation links and similar), use the narrow lookup functions of
  ADR 0006, never a role that bypasses RLS.

## Tests

`src/testing.ts` gives each test file its own database (`erp_test_*`), dropped and rebuilt from the
migrations on every run, on the local Docker Postgres or the CI service container. Tests never touch
the development database `erp`. Defaults match `infra/docker-compose.yml`; `TEST_PG_SERVER`,
`TEST_APP_USER_PASSWORD` and `TEST_APP_OPS_PASSWORD` override them, and a server that is not local
is refused.

| Suite                        | Checks                                                          |
| ---------------------------- | --------------------------------------------------------------- |
| `isolation.int.test.ts`      | RLS on every tenant table, cross-tenant reads and writes, roles |
| `tenant.int.test.ts`         | `withTenant` and the tenant-scoped client against the database  |
| `audit.int.test.ts`          | append-only audit logs and the platform hash chain              |
| `catalogue-sync.int.test.ts` | the catalogue sync, including removed entries                   |
| `*.test.ts` (no database)    | query scoping, the `LOCAL_ONLY` guard and the migration guard   |
