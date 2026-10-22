# @erp/db

Prisma schema, migrations and database client. No models yet. The new build uses only the schemas
`platform`, `identity` and `app`; migration history is kept in `platform._prisma_migrations`
(`schema=platform` in the connection URLs). Schema `public` is never used.

| Script              | Use                                                                       |
| ------------------- | ------------------------------------------------------------------------- |
| `db:validate`       | check the schema                                                          |
| `db:generate`       | generate the client into `src/generated/` (not committed)                 |
| `db:migrate:dev`    | create and apply migrations — **local database only**                     |
| `db:migrate:deploy` | apply committed migrations — the only command allowed on hosted databases |

`prisma.config.ts` refuses `migrate dev`, `migrate reset` and `db push` unless the database host is
`localhost`. It runs before every Prisma command, including direct `prisma …` calls.
