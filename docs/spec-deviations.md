# Differences from the specification

Where the build differs from the ERP System Master Specification v1.0 on purpose, so the spec can
be updated to match. Each entry was accepted by QA; the decision record named in the last column
has the reasoning. Newest first within each section.

## Module, feature and permission registry (Part 10 §10.7.1, Part 11 §11.7)

The registry in `packages/contracts/src/registry` holds 31 modules, 218 features and 462
permission keys (Stage 1).

| Difference                                                                                                                                                                                                                 | Spec                                                               | Where in the code                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------- |
| A permission may be declared by several features (15 such keys, for example `restaurant.orders.create` by `waiter_app`, `cashier`, `takeaway` and `delivery`). It is entitled when **any** feature that declares it is on. | §10.7.1 shows each resource under one feature                      | `catalogue.ts` `featuresOfPermission`                      |
| `restaurant.hub` (Outlet Hub) needs **one of** `restaurant.waiter_app` or `restaurant.kds`: a new `requiresAnyOf` rule beside `requires`.                                                                                  | Dependencies are all-of only                                       | `define.ts` `FeatureInput.requiresAnyOf`, `restaurant.ts`  |
| Localization features have three-segment keys: `localization.pk.tax`, `.fbr`, `.pra`, `.srb`, `.kpra`, `.bra`, `.onebill`, `.payroll`.                                                                                     | Feature keys are `module.feature`                                  | `addons-localization.ts`                                   |
| The core module's organization resources are separate: `legal_entities`, `branches`, `departments`, `teams`, `positions` (each with its own actions).                                                                      | Part 11 §11.10.4 groups them as `core.org.*`                       | `modules/core.ts`                                          |
| A `core.integrations` feature holds `api_keys`, `webhooks` and `integrations`.                                                                                                                                             | §11.10.4 lists `core.integrations.*` permissions without a feature | `modules/core.ts`                                          |
| Core features are always on (`alwaysOn`), except `core.custom_fields`.                                                                                                                                                     | Not stated                                                         | `define.ts` (`alwaysOn` defaults to `category === 'core'`) |

## API (Part 11 §11.9)

| Difference                                                                                                                                                        | Spec                             | Record                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ----------------------- |
| Extra problem codes: `precondition_required` (428, If-Match missing) and `precondition_failed` (412, stale version), plus `internal_error`.                       | "409 or 412 on mismatch"; no 428 | Stage 1 QA ruling 4     |
| The problem `type` URI base comes from `PROBLEM_TYPE_BASE`; until the domain is chosen it uses the reserved `.invalid` domain.                                    | Not stated                       | Stage 1 fix 2d1d3b6; D3 |
| Release flags are read from `platform.feature_flags` with a 30-second cache, overridden per process by `FEATURE_FLAGS`; a flag that cannot be read counts as off. | §10.2 "flags table + console UI" | Stage 1 QA ruling 5     |
| The API's tests run on Jest with `--experimental-vm-modules` (the Prisma 7 client uses dynamic import); the packages use Vitest.                                  | §10.2 "Vitest/Jest"              | Stage 1 QA ruling 8     |

## Identity and sessions (Part 05 §5.3–5.4, Part 10 §10.6, Part 11 §11.10.2)

| Difference                                                                                                                                                                                         | Spec                                                   | Record              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------- |
| Problem codes for sign-in: `invalid_credentials` (401), `mfa_invalid` (401), `step_up_required` (403), `link_invalid` (400); field errors carry a stable `code` (for example `length`).            | §11.9 lists the general codes only                     | Stage 2             |
| Staff accounts are built in (`platform.staff_*`, same shape as `identity.*`) with mandatory TOTP enrolled at the first sign-in, a 30-minute idle limit and a CLI for the first Platform Owner.     | §10.6 "staff identity provider (OIDC) with WebAuthn"   | D5, gap G6          |
| A just-rotated refresh token is accepted for 30 seconds and answered with the same successor (an HMAC of the replaced token); after that, or once the successor is used, reuse revokes the family. | §10.6 "reuse of an old token revokes the whole family" | Stage 2 QA ruling   |
| The breached-password check uses a bundled list of the 49,233 most common passwords; the online Have I Been Pwned range check comes at go-live.                                                    | §5.4 "breached and common passwords rejected"          | Go-live list        |
| The auth module has its own database role, `app_auth`; `app_user` has no access to identity except tenant-owned invitations.                                                                       | §10.5.3 names app_user, app_migrator, app_ops          | ADR 0008, QA F3     |
| Recovery codes are stored as keyed hashes and shown once; "download again" is replaced by "make new codes", which needs a step-up and ends the old set.                                            | §5.3.10: the codes can be downloaded again             | Stage 2 QA ruling 1 |
| Access tokens are refused at once when their session is revoked (a Redis note per revoked session), not only when they expire after 10 minutes.                                                    | §10.6 "10-minute life"                                 | Stage 2             |

## Access engine (Part 02 §2.11–2.12, Part 05 §5.5, Part 10 §10.7)

| Difference                                                                                                                                                                                            | Spec                                                                 | Record   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | -------- |
| The server checks access at the current version on every company request (a 15-second stamp, then a cache by version); the token's `pv` only tells the client to refresh, through `X-Access-Version`. | §10.7.3 "tokens carrying an old pv trigger a silent refresh"         | ADR 0009 |
| Routes about the caller's own account (profile, sessions, MFA, `/me/access`) carry a fourth rule, `@SignedIn()`; the route audit accepts it.                                                          | Stage 3 brief: `@RequirePermission`, `@StaffPermission` or `@Public` | ADR 0009 |
| The Owner holds every permission of every effective feature at company scope, computed rather than stored; deny exceptions never apply to the Owner.                                                  | §4.1 "Everything a Company Admin can, plus…"                         | ADR 0009 |
| Read-only (an expired trial, a read-only suspension, a feature's read-only window) keeps `view`, `view_sensitive` and `export`.                                                                       | §2.11 "keeps view only"; §3.7.2 "view, export"                       | ADR 0009 |
| Team scope covers the members of the teams the member leads, and the member; direct reports (reporting lines) come with the People module.                                                            | §11.8 "team members or direct reports"                               | Stage 3  |
| An allow exception saved without a scope type counts as `own` scope.                                                                                                                                  | §4.9.8 "with scope and mandatory end date"                           | Stage 3  |
| The limit in force: a manual override when there is one, otherwise the larger of the plan's and the template's value plus every add-on.                                                               | §2.11.1 does not say how sources combine                             | Stage 3  |
| `/me/access` answers `home: "home"` and no quick-create items until role home pages exist.                                                                                                            | §10.7.5 "home page, quick-create items"                              | Stage 7  |
| Routes with `@StaffPermission` are refused until the staff permission matrix arrives.                                                                                                                 | Part 03 §3.2.1                                                       | Stage 4  |
| The "Request access" button on the no-access page needs the admins' notification.                                                                                                                     | §5.5.7                                                               | Stage 7  |

## Data and tenancy (Part 10 §10.5, Part 11 §11.3–11.4)

| Difference                                                                                                                                                                            | Spec                                             | Record              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------- |
| `identity.*` tables are global (no `tenant_id`, no RLS) except `invitations`; requests before the tenant is known use narrow SECURITY DEFINER lookups.                                | §10.5.2 covers tenant tables only                | ADR 0006            |
| `identity.users` is unique per (`email_normalized`, `account_kind`) with kinds `member` and `portal`, so a parent's portal account and a teacher's staff account can share an e-mail. | §11.3 makes `email_normalized` unique            | Gap G14             |
| Every reference between tenant rows is a composite foreign key on (`tenant_id`, id). Optional ones are written in SQL (`*_tenant_fk`) because Prisma cannot model them.               | §10.5.2 "composite foreign keys where practical" | Stage 1 QA F1       |
| `app_ops` holds only the grants of the current cross-tenant jobs, not every table.                                                                                                    | §10.5.3 "BYPASSRLS, used only by audited jobs"   | Stage 1 QA F2       |
| The catalogue sync runs as a seed step (`db:seed`, part of `pnpm local:up`); at go-live it joins the release step.                                                                    | §10.7.1 "at deploy, a catalogue sync job"        | Stage 1 QA ruling 7 |

## Environments (Part 10 §10.16)

| Difference                                                                                                                          | Spec                              | Record   |
| ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | -------- |
| Until go-live everything runs on one PC over localhost; nothing deploys, and the `LOCAL_ONLY` guard refuses any non-local database. | Development, staging, production  | ADR 0007 |
| Supabase and Railway run in Singapore (`ap-southeast-1`, `asia-southeast1`).                                                        | "chosen for latency … as an ADR"  | ADR 0005 |
| Main-only commits, no pull requests.                                                                                                | §12.10.4 branches and code review | ADR 0004 |
