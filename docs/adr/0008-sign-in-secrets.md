# 0008. Who reaches sign-in secrets

Date: 25 October 2026 · Status: accepted

## Context

Password hashes, MFA secrets, recovery codes, refresh tokens and reset links sit in `identity.*`
(members) and, for platform staff (decision D5), in `platform.staff_*`. Until Stage 2 the API's
only role, `app_user`, could read and write all of `identity.*`. Every tenant request runs as
`app_user`, so a bug or an injected query in any module could have read every company's
password hashes. And because `identity.users` is global (ADR 0006), `app_user` could also list
the people of every company (QA finding F3).

Two ways were considered:

- **Narrow SECURITY DEFINER functions** for each sign-in step (fetch a hash, store a hash, rotate
  a refresh token, and so on), as ADR 0006 does for invitations. The sign-in rules would then
  live in SQL, about twenty functions, hard to test and to change.
- **A separate database role for the auth module**, with grants on exactly the tables sign-in
  needs and nothing else.

## Decision

- **Role `app_auth`** (no `BYPASSRLS`, no superuser), connected through `AUTH_DATABASE_URL`, is
  used only by the API's auth module. Its connection is a provider private to that module and is
  not exported to other modules.
- **Its grants:** read and write on the member and staff credentials, MFA factors, recovery codes,
  sessions, refresh tokens, reset and e-mail-change links; insert-only login attempts; read and
  update on `identity.users`; read on staff users and their roles, and update of a staff user's
  status and last sign-in only; `EXECUTE` on `platform.append_audit`. Nothing on `app.*` and
  nothing on tenants.
- **`app_user` loses identity.** It keeps only `identity.invitations`, which are tenant rows
  under RLS. Member lists (Stage 7) will read people through a lookup scoped to the current
  tenant.
- **Staff accounts are created by the operator**, not the API: the CLI that creates the first
  Platform Owner runs as the database owner and e-mails a one-time setup link. `app_auth` can
  neither create staff users nor assign staff roles.
- **Sign-in finds a person's companies** through `identity.memberships_of_user(user)`, and the
  MFA policy (gap G16) through `identity.mfa_required_by_company(user)`. Both follow ADR 0006:
  SECURITY DEFINER, owned by `app_ops`, which holds `SELECT` on the columns they read only, and
  executable by `app_auth` alone.
- **Secrets at rest:** passwords are Argon2id (19 MiB, 2 iterations, parallelism 1, parameters in
  the stored hash); TOTP secrets are encrypted with AES-256-GCM under `AUTH_ENCRYPTION_KEY`;
  recovery codes, refresh tokens and link tokens are stored as hashes only.

## Consequences

- A query run by any tenant module can no longer reach a password hash, an MFA secret or another
  company's people, whatever the code does: the database refuses it.
- The auth module still shares the API process. A bug that runs arbitrary code in the API could
  use the `app_auth` connection; separating the auth service into its own process is possible
  later without changing the data model.
- At go-live, `app_auth` needs its own password in the hosted database, created as the Supabase
  admin like the other roles, and `AUTH_DATABASE_URL` is a separate secret.
- The privilege tests (`packages/db/src/identity-access.int.test.ts`, `ops.int.test.ts`) list the
  exact grants of `app_auth` and `app_ops`; any new grant shows up as a change to those lists.
