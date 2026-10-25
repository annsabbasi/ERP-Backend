# 0006. Data access before the tenant is known

Date: 25 October 2026 · Status: accepted

## Context

Row-level security hides every tenant-owned row until a request sets `app.tenant_id`
(Part 10 §10.5.3). Some requests arrive before the tenant is known: sign-in, accepting an
invitation, pairing a device, PIN sign-in on a shared device, and the public forms (booking,
admission). They must find out which tenant a token or credential belongs to without being able to
read any other tenant's data (gap G15 of the plan).

## Decision

- **Identity is global.** `identity.users`, `credentials`, `mfa_factors`, `recovery_codes`,
  `sessions`, `refresh_tokens`, `password_resets` and `login_attempts` belong to a person, not to a
  company (one person can be a member of several), so they carry no `tenant_id` and no RLS. The API
  reaches them as `app_user` only in the authentication flows.
- **Tenant-owned rows stay behind RLS.** `identity.invitations` and every `app.*` table have
  `tenant_id` and the `tenant_isolation` policy, forced, like any other tenant data.
- **Narrow lookups.** For each pre-tenant flow there is one `SECURITY DEFINER` function owned by
  `app_ops`. It takes a token hash or credential, returns only the tenant id and the few columns the
  flow needs, sets `search_path` explicitly, and is granted `EXECUTE` to `app_user` alone. The API
  then opens a normal tenant transaction for that tenant, and RLS applies from then on.
- **Tokens are stored hashed.** Lookups take the SHA-256 hash of the token, never the token itself.
- The first lookup is `identity.invitation_by_token_hash(text)` (Stage 1). Device pairing, PIN
  sign-in and the public forms add theirs in the stages that build them, each with an isolation test
  showing that it returns nothing for an unknown token and nothing from other tenants.

## Consequences

- `app_user` never needs `BYPASSRLS`, and no request reads tenant data without a tenant context.
- Each new pre-tenant flow needs a reviewed function and its own test; a generic "find tenant by
  anything" function is not allowed.
- The isolation suite (`packages/db/src/isolation.int.test.ts`) checks that the lookup finds an
  invitation by token hash before any tenant is set, and nothing else.
