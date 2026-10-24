# 0001. Monorepo with pnpm workspaces and Turborepo

Date: 22 October 2026 · Status: accepted; amended by 0003 (the apps are split across two
repositories, each one a monorepo as described here)

## Context

The system has several apps (API, worker, web app, Platform Console, desktop app) that share types,
validation, translations and UI. In the previous build the API and the desktop client lived in two
repositories with hand-written copies of each other's types; a field renamed on one side broke the
other without any check noticing. The rebuild follows the structure in Part 10 §10.2–10.3 of the
specification.

## Decision

- One repository holds every app under `apps/` and every shared package under `packages/`.
- pnpm workspaces manage dependencies; one `pnpm-lock.yaml` pins every version.
- Turborepo runs `dev`, `build`, `lint`, `typecheck` and `test` across the workspace, building
  shared packages before the apps that use them and caching results.
- Shared request and response shapes are Zod schemas in `@erp/contracts`, imported by both the API
  and its clients.
- Shared tooling lives in `@erp/config` (TypeScript, ESLint, Prettier).

## Consequences

- A contract change fails type checking in every app that uses it, in the same pull request.
- One CI workflow checks the whole system on each push.
- Contributors need pnpm (through Corepack) and must run commands from the repository root or with
  `--filter`.
- Apps that deploy separately (API, worker, web, console) each need their own build settings that
  build only their part of the workspace.
