# 0007. Local-only development until go-live

Date: 25 October 2026 · Status: accepted; updated 25 October 2026 (`OPS_DATABASE_URL` guarded; `app_ops` least privilege)

## Context

On 25 October 2026 the document owner decided that, until the hosting environments are ready,
nothing is deployed. The whole system runs on the developer's PC and the parts talk to each other
over localhost, with local credentials only; the live database is not used. Code is still committed
and pushed to `main`, and CI checks every push (ADR 0004).

Until then a push could reach hosted services: Railway watched the server paths for the api and the
worker, and its api deploy runs `migrate deploy` before starting; the Vercel projects of the web app
and the Platform Console build from erp-electron; and the old Vercel project `erp-backend` was still
connected to ERP-Backend and built a failed preview on 24 October 2026. Part 10 §10.16 describes
development, staging and production environments; they are deferred until go-live.

## Decision

- **Local stack.** The api and the worker (ERP-Backend) run against the Docker services in
  `infra/docker-compose.yml`: Postgres 16 on host port 5433, Redis 7 on 6381, MinIO on 9000/9001
  and Mailpit on 1025/8025 (ports from `infra/.env`). The web app runs on 5173, the Platform Console
  on 5174, and the desktop app loads the web app. The runbook is `docs/local-dev.md` in each
  repository.
- **Local credentials only.** Each `.env` is created from `.env.example`. The live database values
  are not in the active `.env`; in the owner's ERP-Backend clone they are kept, unused, in
  `.env.live`, which `.gitignore` excludes like every `.env.*` file.
- **The ops connection.** `OPS_DATABASE_URL` connects as `app_ops`, which bypasses RLS. It holds
  only the grants of the current cross-tenant jobs (today the outbox dispatch, plus the tables behind
  the functions it owns) and nothing on sign-in secrets or migration history. Each stage that adds a
  job adds its grants.
- **`LOCAL_ONLY` guard.** `LOCAL_ONLY=1` is set in `.env.example` and in CI. While it is set, the
  api and the worker refuse to start, the seed refuses to run, and `packages/db/prisma.config.ts`
  refuses every Prisma command, `migrate deploy` included, when `DATABASE_URL`, `DIRECT_URL`,
  `OPS_DATABASE_URL` or `REDIS_URL` points at any host other than `localhost`, `127.0.0.1` or `::1`.
- **Deploy switches off, inside the repositories:**
  - erp-electron `apps/web/vercel.json` and `apps/console/vercel.json`:
    `"git": { "deploymentEnabled": false }`.
  - ERP-Backend `vercel.json` at the root, containing only `{ "git": { "deploymentEnabled": false } }`,
    for the old `erp-backend` project. It works only while that project builds from the repository
    root; disconnecting the project in Vercel remains the sure way.
  - ERP-Backend `apps/api/railway.json` and `apps/worker/railway.json`:
    `"watchPatterns": ["deploy/railway-release.txt"]`. That file does not exist, so no change
    starts a build.
- **Pushes are normal** under ADR 0004: small commits to `main`, CI green. The push gate of
  25 October 2026, which held back commits touching the server paths, is replaced by these
  switches and the guard.

The `watchPatterns` before this change, to restore at go-live:

| Service | `watchPatterns`                                                                                        |
| ------- | ------------------------------------------------------------------------------------------------------ |
| api     | `apps/api/**`, `packages/**`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `turbo.json`    |
| worker  | `apps/worker/**`, `packages/**`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `turbo.json` |

## Turning deploys back on (go-live)

1. The document owner provides the staging Supabase project in ap-southeast-1, the Railway and
   Vercel logins, the domain (decision D3), the e-mail provider (D4), the Turnstile keys (D8), the
   legal text (D9) and code signing (D11).
2. The developer builds staging (Railway in asia-southeast1, Vercel), with secrets only in the
   platforms' variables, never in a repository. Then the switches above are turned back on for
   staging only: the original `watchPatterns` restored and `deploymentEnabled` removed for the
   staging projects. `LOCAL_ONLY` is never set in a hosted environment. Production deploys only by
   manual promote.
3. Local, CI and Supabase are checked to run the same Postgres major version, and the Gate C flows
   are run again on staging.
4. QA approves, then production is promoted.

## Consequences

- No push reaches a hosted service. Every stage, its QA gate included, is checked on the local
  stack; staging is only verified at go-live.
- Mistakes that only show on hosted infrastructure (TLS to the database, the connection pooler,
  cross-site cookies, real e-mail delivery) surface at go-live, not earlier. The go-live steps
  above exist to catch them.
- A database or Redis URL that is not local stops the api, the worker, the seed and Prisma while
  `LOCAL_ONLY` is set, so the live database cannot be touched by accident.
- Part 10 §10.16 of the specification needs a note pointing to this record.
