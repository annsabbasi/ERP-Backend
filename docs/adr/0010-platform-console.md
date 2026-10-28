# 0010. How the Platform Console decides and records what staff may do

Date: 29 October 2026 · Status: accepted

## Context

Part 03 gives the Platform Console seven staff roles (§3.2), a permission table where some
cells say "with a second approver" (◐, §3.2.1), a fresh MFA check before sensitive actions
(§3.3.1), and a catalogue whose templates and country packs move through Draft, In review,
Published and Deprecated with a second approver (§3.11, AC-P10). Every console change must be
audited with actor, reason, before and after values, and the entry can never be changed
(AC-P12). Stage 3 left four questions for this stage:

- **Which database role the console uses.** `app_user` is the tenant role under RLS and must not
  reach control-plane tables; `app_ops` is for audited cross-tenant jobs. Stage 3 QA (F4) also
  asked that `app_user` lose `EXECUTE` on `platform.append_audit`, which only the console and the
  sign-in path should call.
- **Where the permission table lives** so the API, the sidebar and the tests read the same one.
- **How "with a second approver" works** without each screen inventing its own rules.
- **What the shipped templates, the Pakistan pack and the plans are**: code, or data staff can
  change.

## Decision

- **A fourth login role, `app_platform`** (`PLATFORM_DATABASE_URL`), for the console only. It
  has exactly the grants the console needs on `platform.*` (catalogue, plans and add-ons,
  templates, country packs, staff, approvals, sessions for ending them) and `SELECT` on the
  platform audit log, which it writes only through `platform.append_audit`. `EXECUTE` on
  `append_audit` moved from `app_user` to `app_platform` (F4); `app_ops` and `app_auth` keep
  theirs. A test lists the role's grants exactly and checks fifteen refusals.
- **One permission table, in contracts.** `STAFF_MATRIX` (`packages/contracts/src/staff.ts`)
  writes §3.2.1 row by row with two modes, `allow` and `four_eyes`; a staff member holds the
  strongest mode any of their roles gives. Routes declare `@StaffPermission(...anyOf)`; the
  guard reads the staff member's roles (cached 15 seconds in Redis). `CONSOLE_MENU` lists the
  console screens with the permissions each needs, and `/api/platform/v1/me/access` returns the
  filtered sidebar and the approvals badge, so the console shows only what the API allows.
- **Four-eyes as one table and one service.** A change held with `four_eyes` becomes a row in
  `platform.staff_approvals` (action, target, payload, reason, requester) and answers
  `202 {status: "pending"}`. Another staff member holding the approving permission
  (`catalogue.publish`, `country_packs.publish` or `catalogue.prices`) approves or rejects it; the
  service that owns the change registers a handler and runs it inside the approval's transaction,
  with the audit entry. The requester can withdraw; a request expires after 7 days. Nobody
  decides their own request: the service refuses it, and a `CHECK` in the database refuses it
  again.
- **Publishing a template or a country pack always takes two people, the Owner included**
  (§3.11 "Publishing requires a second approver"; AC-P10), although the §3.2.1 table shows the
  Owner with a full tick. Approving a new version publishes it and deprecates the previous one;
  a unique index keeps one published version per template and per country.
- **Step-up.** Inviting staff, changing their roles, deactivating them, and requesting or
  approving a country-pack publish need an MFA check from the last 10 minutes; the API answers
  `step_up_required` and the console asks for a code, then repeats the action.
- **Templates and packs are data, checked by code.** A template version is a JSON definition
  (entitlements, limits, roles with grants, terminology, wizard steps) validated against the
  registry by `templateProblems`: unknown features or permissions, a grant whose feature the
  template does not entitle, a feature without the features it requires. Drafts may be saved with
  problems so work is not lost; a publish request and an approval are refused while any remain.
  Drafts are edited with `If-Match` on their revision.
- **Shipped data is a release step.** The three templates, Pakistan 1.0 and four private plans
  are inserted by `db:seed` when absent, each with a `release.*` audit entry, and are never
  overwritten; later versions are made in the console.
- **Every console change is audited in its own transaction** through `append_audit`: actor,
  action, target, reason (required on every change), before, after, result. The platform audit
  log is append-only: triggers refuse `UPDATE`, `DELETE` and `TRUNCATE` for every role, the
  owner included, and `app_platform` holds only `SELECT`. Owner, Platform Admin and Auditor see
  every entry; Onboarding and Support see their own, Billing the billing entries, Operations the
  operations entries. Owner and Auditor can export CSV (cells starting with `=`, `+`, `-` or `@`
  are prefixed so spreadsheets do not run them).

## Consequences

- Adding a console screen means one `CONSOLE_MENU` entry and `@StaffPermission` on its routes;
  the sidebar, the route audit and the guard follow.
- Only three actions use four-eyes so far (template publish, country-pack publish, price
  changes). The other ◐ cells (enterprise provisioning, entitlement overrides by Onboarding,
  termination, refunds, break-glass) gain handlers in the stages that build those actions.
- The shipped plans carry placeholder limits and no prices until the business sets them; a
  Billing Manager's price change waits for the Owner or a Platform Admin.
- Deactivating a staff member sets their status to `suspended` and ends their sessions at once.
