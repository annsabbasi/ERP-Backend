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
