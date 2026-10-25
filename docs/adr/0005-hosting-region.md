# 0005. Hosting region

Date: 25 October 2026 · Status: accepted (applies from go-live, ADR 0007)

## Context

Every company request runs in one database transaction that starts with
`set_config('app.tenant_id', …, true)` (Part 10 §10.5.3), so each request makes at least one more
round trip to the database than it would without row-level security, and most make several. The
distance between the API and the database multiplies that cost (gap G10 of the plan). The existing
Supabase project is in `ap-southeast-1` (Singapore), close to the first customers in Pakistan.

## Decision

- The staging and production Supabase projects are created in `ap-southeast-1`.
- The Railway services (api and worker) run in `asia-southeast1`, Railway's Singapore region, next
  to the database. Redis runs in the same Railway region.
- The web app and the Platform Console are static builds on Vercel; their region does not matter,
  because they only call the API. If server functions are ever added there, they go in `sin1`.
- A move to another region moves the database and the services together.

## Consequences

- Database round trips stay inside one region, so RLS adds little to each request.
- Nothing is hosted until go-live (ADR 0007). Step 2 of its go-live list creates the services in
  these regions.
