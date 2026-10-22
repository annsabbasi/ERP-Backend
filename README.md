# ERP System

Monorepo for the ERP System: API, background worker, web app, Platform Console and desktop app, with
the packages they share. Built with pnpm workspaces and Turborepo.

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
cp .env.example .env        # local settings; never commit .env
docker compose -f infra/docker-compose.yml up -d
```

If a default port is taken on your machine (5432, 6379, 9000/9001, 1025/8025), set another one in
`infra/.env` (for example `POSTGRES_PORT=5433`) and use the same port in `.env`.

## Run

```sh
pnpm dev          # api, worker, web, console and desktop together
```

| App                            | Address                                                                      |
| ------------------------------ | ---------------------------------------------------------------------------- |
| API                            | http://localhost:3000/api/v1 (health: `/health`, readiness: `/health/ready`) |
| Web app                        | http://localhost:5173                                                        |
| Platform Console               | http://localhost:5174                                                        |
| Desktop                        | Electron window that loads the web app                                       |
| Mail (Mailpit)                 | http://localhost:8025                                                        |
| Object storage (MinIO console) | http://localhost:9001                                                        |

Other commands, all run through Turborepo: `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test`.

## Database

Prisma lives in `packages/db`. Only `pnpm --filter @erp/db db:migrate:deploy` may run against a hosted
database; `migrate dev`, `migrate reset` and `db push` are refused unless the host is `localhost`.
Tests use only the local Docker services.

## Folder map

```text
apps/
  api/            NestJS API, every route under /api/v1
  worker/         NestJS standalone app running BullMQ queues
  web/            React web app (Vite, Tailwind CSS, TanStack Router and Query)
  console/        React Platform Console (Vite)
  desktop/        Electron shell around the web app
packages/
  contracts/      Zod schemas and types shared by the API and its clients
  db/             Prisma schema, migrations and client
  ui/             Design tokens and shared React components
  i18n/           Translations (en, ur) and the i18next loader
  sdk/            Typed API client (empty for now)
  auth-client/    Client-side sign-in and session handling (empty for now)
  sync/           Offline store and sync for the desktop app (empty for now)
  config/         Shared TypeScript, ESLint and Prettier configuration
infra/            docker-compose.yml for local services
docs/adr/         Architecture decision records
```
