# Local development

The whole system runs on one PC and nothing deploys (`docs/adr/0007-local-only-until-go-live.md`).
This repository runs the API, the worker and the Docker services; erp-electron runs the web app,
the Platform Console and the desktop app, which call the API over localhost. Use local values only:
never put a hosted database, Redis or any other live credential into `.env`.

## Prerequisites

- Docker Desktop, running
- Node.js 22 (`.nvmrc`) and pnpm 10 through Corepack (`corepack enable`)
- ERP-Backend and erp-electron cloned side by side, for example `C:\dev\erp\ERP-Backend` and
  `C:\dev\erp\erp-electron` (outside OneDrive)

## First time

```sh
corepack enable
pnpm install
git config core.hooksPath .githooks
cp .env.example .env        # local values only; keep LOCAL_ONLY=1
```

Do the same in erp-electron (its `docs/local-dev.md`).

## Start and stop

Start in this order, each in its own terminal:

| Step | Where        | Command         | What it does                                                                                                                                                            |
| ---- | ------------ | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | ERP-Backend  | `pnpm local:up` | Starts Postgres, Redis, MinIO and Mailpit in Docker, waits until they are healthy, applies migrations, gives the local database roles their logins, loads the catalogue |
| 2    | ERP-Backend  | `pnpm dev`      | Starts the API on port 3000 and the worker                                                                                                                              |
| 3    | erp-electron | `pnpm dev`      | Starts the web app (5173), the Platform Console (5174) and the desktop window                                                                                           |

Check that everything is connected:

```sh
curl http://localhost:3000/api/v1/health/ready
# {"status":"ok","db":"ok","redis":"ok"}
```

To stop: Ctrl+C in both `pnpm dev` terminals, then `pnpm local:down` here. The Docker volumes keep
the data. To start again from an empty database, run
`docker compose -f infra/docker-compose.yml down -v` (deletes all local data), then `pnpm local:up`.

## Ports

| Port      | Service                                      | Runs from    |
| --------- | -------------------------------------------- | ------------ |
| 3000      | API (`/api/v1`)                              | ERP-Backend  |
| 5173      | Web app (also loaded by the desktop app)     | erp-electron |
| 5174      | Platform Console                             | erp-electron |
| 5433      | Postgres 16.13                               | Docker       |
| 6381      | Redis 7.4.8                                  | Docker       |
| 9000/9001 | MinIO: S3 API / web console                  | Docker       |
| 1025/8025 | Mailpit: SMTP / web UI that shows every mail | Docker       |

When a port is taken, set another one in `infra/.env` (`POSTGRES_PORT`, `REDIS_PORT`, `MINIO_PORT`,
`MINIO_CONSOLE_PORT`, `MAILPIT_SMTP_PORT`, `MAILPIT_UI_PORT`) and use the same port in the URLs in
`.env`.

## Test accounts

Passwords are never written here. Each comes from your local `.env`.

| Account           | Used for                                 | Password from             |
| ----------------- | ---------------------------------------- | ------------------------- |
| Postgres `erp`    | The local database                       | `DATABASE_URL` in `.env`  |
| MinIO `erp-minio` | MinIO web console, http://localhost:9001 | `S3_SECRET_KEY` in `.env` |
| Mailpit           | http://localhost:8025, no sign-in        | —                         |

Application accounts (the Platform Owner from Stage 2, demo companies from Stage 5) are created by
the seed and listed here when they arrive.

## Database connections

| Setting            | Role       | Used by                                                     |
| ------------------ | ---------- | ----------------------------------------------------------- |
| `DATABASE_URL`     | `app_user` | the API and the worker's event handlers; row-level security |
| `OPS_DATABASE_URL` | `app_ops`  | the worker's cross-tenant jobs (outbox dispatch)            |
| `DIRECT_URL`       | `erp`      | migrations and the seed                                     |

`packages/db/README.md` explains the roles and how tenant data is reached.

## Tests

```sh
pnpm local:up                            # the tests need the Docker Postgres and Redis
pnpm turbo run lint typecheck test build # what CI runs on every push
```

Each database test file builds its own `erp_test_*` database from the migrations, so the
development database `erp` is never touched. The API tests run against `erp_test_api`, and the
worker tests use their own Redis key prefix.

## The LOCAL_ONLY guard

The guard is on unless `LOCAL_ONLY=0` or `NODE_ENV=production` (`.env.example` and CI also set
`LOCAL_ONLY=1`). While it is on, the API, the worker, the seed and every Prisma command, `migrate
deploy` included, refuse to run when `DATABASE_URL`, `DIRECT_URL`,
`OPS_DATABASE_URL` or `REDIS_URL` points anywhere but `localhost`, `127.0.0.1` or `::1`. The error
names the setting and its host, never the password.

## Troubleshooting

| Symptom                                                                                               | Fix                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm local:up` fails with "Cannot connect to the Docker daemon" or "error during connect"            | Start Docker Desktop, wait until it shows "Engine running", then run it again                                                                                                                                                                                   |
| "Bind for 0.0.0.0:5433 failed: port is already allocated" (or another port)                           | Find the program with `netstat -ano \| findstr :5433` (Windows) and stop it, or choose another port in `infra/.env` and in `.env`                                                                                                                               |
| The API stops with "LOCAL_ONLY is on, so the API refuses to run"                                      | A URL in `.env` points at another machine. Copy the line back from `.env.example`                                                                                                                                                                               |
| `/health/ready` answers `"db":"error"` or `"redis":"error"`                                           | The Docker services are not up: run `pnpm local:up`                                                                                                                                                                                                             |
| After an API restart, authenticator codes are refused, recovery codes fail and everyone is signed out | `.env` has no `AUTH_JWKS` or `AUTH_ENCRYPTION_KEY`, so the API made temporary keys for that run (it logs "using a temporary signing key"). Run `pnpm --filter @erp/api auth:init` (part of `pnpm local:up`), restart the API, and enrol the authenticator again |
| Windows says "An Application Control policy has blocked this file"                                    | Smart App Control blocks some unsigned programs (the Railway CLI is one; Electron 45 runs). Event Viewer › CodeIntegrity › Operational, event 3077, names the file. Run such tools from their Docker image instead                                              |
