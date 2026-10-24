# ERP System — server

API, background worker and database for the ERP System, with the packages they share. Built with
pnpm workspaces and Turborepo. The web app, Platform Console and desktop app live in
[erp-electron](https://github.com/MuhammadAdil01/erp-electron) (see
`docs/adr/0003-server-and-client-repositories.md`).

The previous build (installer 1.0.3) is kept, read-only, on branch `backup/2026-10-22-pre-rebuild`;
its old branches are tags under `legacy/`. New code does not come from there unless a task says so.

## Prerequisites

- Node.js 22 (`.nvmrc`)
- pnpm 10, through Corepack: `corepack enable`
- Docker Desktop, for the local services

## Set up

```sh
corepack enable
pnpm install
git config core.hooksPath .githooks   # commit checks, see docs/adr/0004-direct-commits-to-main.md
cp .env.example .env        # local settings; never commit .env
docker compose -f infra/docker-compose.yml up -d
```

If a default port is taken on your machine (5432, 6379, 9000/9001, 1025/8025), set another one in
`infra/.env` (for example `POSTGRES_PORT=5433`) and use the same port in `.env`.

## Run

```sh
pnpm dev          # api and worker together
```

| App                            | Address                                                                      |
| ------------------------------ | ---------------------------------------------------------------------------- |
| API                            | http://localhost:3000/api/v1 (health: `/health`, readiness: `/health/ready`) |
| Mail (Mailpit)                 | http://localhost:8025                                                        |
| Object storage (MinIO console) | http://localhost:9001                                                        |

For the web app, Platform Console and desktop app, run erp-electron next to this repository; they
call this API.

Other commands, all run through Turborepo: `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test`.

## Database

Prisma lives in `packages/db`. Only `pnpm --filter @erp/db db:migrate:deploy` may run against a hosted
database; `migrate dev`, `migrate reset` and `db push` are refused unless the host is `localhost`.
Tests use only the local Docker services.

## Shared contracts

`packages/contracts` (request and response shapes) is owned by this repository. erp-electron keeps an
exact copy, and its CI fails when the copy differs from `main` here. After a contract change is
pushed to `main` here, copy the same files to erp-electron and push them to its `main` the same day.

## How changes land

All work is committed straight to `main`: no feature branches, no pull requests
(`docs/adr/0004-direct-commits-to-main.md`).

- Every commit is authored and pushed as `annsabbasi <annsabbasi54@gmail.com>`, with no co-author
  or generated-by lines. The `commit-msg` hook (Set up, above) and the CI job `commit-hygiene`
  refuse anything else.
- Before every push, `pnpm turbo run lint typecheck test build` passes locally. After the push, CI
  must be green before the next batch starts. A red `main` is fixed forward the same day; never
  force-push.
- Commits are small, follow Conventional Commits (`feat(api): …`), build on their own, and name the
  specification section in the body (`Spec: Part 03 §3.9.2`).
- Unfinished endpoints stay behind feature flags until their stage passes QA.

To check the history yourself: `sh .github/scripts/commit-hygiene.sh`.

## Folder map

```text
apps/
  api/            NestJS API, every route under /api/v1
  worker/         NestJS standalone app running BullMQ queues
packages/
  contracts/      Zod schemas and types shared by the API and its clients
  db/             Prisma schema, migrations and client
  config/         Shared TypeScript, ESLint and Prettier configuration
infra/            docker-compose.yml for local services
docs/adr/         Architecture decision records
.githooks/        Git hooks (git config core.hooksPath .githooks)
.github/          CI workflow and its scripts
```
