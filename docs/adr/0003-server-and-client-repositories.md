# 0003. Two repositories: server in ERP-Backend, clients in erp-electron

Date: 24 October 2026 · Status: accepted · Supersedes 0002

## Context

ADR 0002 put every app in ERP-Backend and left erp-electron with only a README. On 24 October 2026
the document owner decided to keep the two repositories the previous build had: one for the server
and one for the client apps. Part 10 §10.3 of the specification shows a single monorepo, so this
record is the deviation from it.

## Decision

- **ERP-Backend** holds the server: `apps/api`, `apps/worker`, `packages/db`, `packages/contracts`
  and `packages/config`.
- **erp-electron** holds the clients: `apps/web`, `apps/console`, `apps/desktop`, `packages/ui`,
  `packages/i18n`, `packages/sdk`, `packages/auth-client`, `packages/sync`, and its own copies of
  `packages/contracts` and `packages/config`.
- Each repository is a pnpm + Turborepo monorepo (ADR 0001) with its own lockfile and CI.
- `packages/contracts` (request and response shapes, and later the module, feature and permission
  registry of §10.7.1) is owned by ERP-Backend. erp-electron keeps an exact copy; its CI job
  `contracts` fails whenever the copy differs from ERP-Backend `main`. A contract change is merged in
  ERP-Backend first and then copied, unchanged, to erp-electron.
- `packages/config` starts as the same files in both repositories; each repository may change its own
  copy.
- In both repositories the previous build stays on branch `backup/2026-10-22-pre-rebuild`, and every
  old branch is a tag under `legacy/`.

## Consequences

- A feature that changes both the API and its screens needs a pull request in each repository,
  ERP-Backend first. A contract change no longer fails the client's type check in the same pull
  request (ADR 0001); the `contracts` check catches drift on the next client build instead.
- Two CI workflows. The API and worker deploy from ERP-Backend; the web app and Platform Console
  deploy from erp-electron, so their hosting projects connect to that repository.
- erp-electron belongs to a personal GitHub account, so its settings and rulesets can be changed only
  by that account.
- Part 10 §10.3 of the specification needs a note pointing to this record.
- Anyone with an old clone of either repository must re-clone.
