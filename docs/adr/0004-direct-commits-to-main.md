# 0004. Direct commits to main

Date: 24 October 2026 · Status: accepted

## Context

Part 12 §12.10.4 of the specification describes trunk-based development with short-lived branches
and at least one reviewer per change (two for authentication, tenancy, payments and fiscal code). On
24 October 2026 the document owner decided that all work in ERP-Backend and erp-electron goes
straight to `main`, with no feature branches and no pull requests, and that every commit is authored
and pushed with the owner's own account. Without pull requests nothing reviews a change before it
lands, so this record lists what takes the place of that review. It is a deviation from §12.10.4.

## Decision

- **One branch.** All work is committed to `main` and pushed directly. Branch
  `backup/2026-10-22-pre-rebuild` and the `legacy/*` tags stay frozen.
- **One author.** Every commit is authored and committed as `annsabbasi <annsabbasi54@gmail.com>`
  and pushed with that GitHub account. No message carries a `Co-authored-by:` line or a
  generated-by line.
- **Checks before the push.** `pnpm turbo run lint typecheck test build` passes locally before
  every push. The `commit-msg` hook in `.githooks/` refuses a commit with a co-author line or with
  another author or committer e-mail; enable it once per clone with
  `git config core.hooksPath .githooks`.
- **Checks after the push.** CI runs on every push: job `check` (lint, type check, tests, build)
  and job `commit-hygiene`, which applies the hook's rules to every commit on `main` after the
  baseline set in `.github/workflows/ci.yml`. The next batch of work starts only when CI is green.
- **Fix forward.** A red `main` is fixed with a new commit the same day. History is never
  rewritten; the only exception is the one-time removal of co-author trailers from ERP-Backend
  `main` (decision D1 of the staged delivery plan).
- **Small commits.** Conventional Commits (`feat(api): …`). Each commit builds and passes on its
  own, and its body names the specification section it implements (`Spec: Part 03 §3.9.2`).
- **Contracts.** A change to `packages/contracts` is committed in ERP-Backend first and copied
  unchanged to erp-electron the same day, so the `contracts` job there stays green (ADR 0003).
- **Feature flags.** Unfinished endpoints and screens stay behind feature flags until their stage
  passes QA, so a push to `main` never shows half-built work to customers.
- **Staging first** (once decision D2 is confirmed). A push to `main` deploys automatically to
  staging. Production changes only by a manual promote, after the change has been checked on
  staging.
- **QA per stage.** Work is delivered in stages. At the end of each stage the developer reports
  the commits, CI runs and raw evidence; QA checks authors, trailers and CI on GitHub and runs the
  stage's acceptance criteria before the next stage starts. The report names every commit that
  touches identity, tenancy, payments or fiscal code, the areas §12.10.4 sends to a second
  reviewer.

## Consequences

- Nothing reviews a commit before it reaches `main`. Problems are caught after the push, by CI,
  staging and QA, so commits stay small enough to check and revert one at a time.
- `main` can be red for a short time; making it green comes before any new work.
- Commits from any other account are refused by the hook and fail `commit-hygiene`. Accepting
  another contributor needs a new decision.
- GitHub rules that require pull requests or reviews are not used.
- Part 12 §12.10.4 of the specification needs a note pointing to this record.
