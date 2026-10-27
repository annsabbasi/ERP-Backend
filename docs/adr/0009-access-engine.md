# 0009. How the API decides what a member may do

Date: 28 October 2026 · Status: accepted

## Context

Part 02 §2.12 puts every request through three gates: the company is entitled to the feature,
one of the member's roles grants the permission, and the record is within that grant's scope.
Part 10 §10.7.3 caches each member's access under (tenant, membership, pv) and lets tokens with
an old `pv` "trigger a silent refresh, so changes apply within about a minute" (AC-U07: within 60
seconds). Three questions were open:

- **What moves `pv`.** If code had to remember to bump a version after every role, grant,
  exception or entitlement change, one forgotten path would leave access stale until the token
  expired.
- **Whether the server may trust the token's `pv`.** A token lives ten minutes. If the server
  evaluated access at the token's `pv`, a removed permission would keep working until the client
  chose to refresh.
- **How tenant code reads control-plane rows** (entitlements, limits, status), which `app_user`
  may not read (§10.5.3).

## Decision

- **Triggers move the versions, whoever writes.** `app.memberships.permissions_version` moves when
  the member's roles, a held role's grants, key, protection or archiving, the member's exceptions,
  branch, department or status change. `platform.tenants.entitlements_version` moves with the
  company's entitlements, limits and status. The token's `pv` is their sum.
- **The server checks current access on every company request.** A small stamp (membership
  status, company status, Owner or not, both versions) is read per request and cached for 15
  seconds (`ACCESS_STAMP_SECONDS`); the full access is cached under (tenant, membership, current
  pv, status) for at most a minute, and no longer than until an entitlement, trial or exception
  ends. The token's `pv` is not trusted: it only tells the client when to refresh. Every company
  response carries `X-Access-Version`; the client refreshes its token and reloads `/me/access`
  when that number moves past what it holds.
- **Views, not grants, for control-plane rows.** `platform.current_tenant`,
  `current_tenant_entitlements` and `current_tenant_limits` show the transaction's own tenant
  (`app.tenant_id`) and nothing without one; `app_user` still has no right on the tables.
- **Guards in the gate order:** authentication, release flags, Tenant (membership active; company
  status lets the member in and allows the action), Entitlement, Permission. Scope is checked
  where records are read (`ScopeService`). Every route declares one rule: `@Public()`,
  `@SignedIn()` (own account), `@RequirePermission(key)` or `@StaffPermission(key)`; a route audit
  test fails the build otherwise, and an undeclared route is refused at run time.
- **The Owner** holds every permission of every effective feature at company scope, computed, not
  stored, so a newly entitled feature reaches the Owner at once. Deny exceptions never apply to
  the Owner (Part 04 §4.23).
- **Company status** follows Part 03 §3.7.2: trial, active and past due work fully; an expired
  trial or a read-only suspension keeps view, sensitive view and export (the Owner may still
  subscribe after a trial); a locked company lets only the Owner in, to pay and export; a closing
  one only the Owner, to export. Sign-in and the guard use the same rule (`canEnterTenant`), so a
  token is never issued for a company the guard then refuses.

## Consequences

- A removed permission, a suspended member or a suspended company is refused within 15 seconds
  (measured: 15.6 s), whatever token the client holds.
- Each company request costs one Redis read, and a small database read every 15 seconds per
  member. Writes that must apply at once can call `AccessService.forget(tenant, membership)`.
- Department and team trees are resolved when access is computed; a new sub-department or team
  member reaches department and team scope within a minute (the access cache), without moving
  `pv`.
- A provisioning job running as `app_ops` that writes role grants will need `EXECUTE` on
  `app.bump_role_members` and `UPDATE (permissions_version)` on memberships (Stage 5).
