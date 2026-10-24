# 0002. One repository: ERP-Backend; erp-electron archived

Date: 22 October 2026 · Status: superseded by 0003 (24 October 2026)

## Context

The previous build was split across two repositories: ERP-Backend (API) and erp-electron (desktop
client). Both were reset on 22 October 2026 for the rebuild. ADR 0001 puts every app in one
monorepo, so one of the two repositories had to become its home.

## Decision

- The monorepo lives in ERP-Backend. It holds the API, worker, web app, Platform Console and desktop
  app.
- erp-electron receives no new code. Its `main` only has a README pointing to ERP-Backend.
- In both repositories the previous build stays on branch `backup/2026-10-22-pre-rebuild`, and every
  old branch is a tag under `legacy/`. Code comes from there only when a task names it.

## Consequences

- One place for issues, pull requests, CI and deployments.
- The repository name ERP-Backend no longer describes everything in it; renaming it is a separate
  decision.
- Anyone with an old clone of either repository must re-clone or hard-reset to the new `main`.
