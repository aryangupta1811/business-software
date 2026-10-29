# 0006 — Multi-tenancy: shared tables with business_id and Row-Level Security

- **Date:** 2026-10-29
- **Status:** Accepted

## Context

Many businesses sign up, and each must see only its own data (`product-overview.md` NFR 2). One owner can run several branches, each with its own stock (Module 00 #12). There's no super-admin panel in v1 (Module 00 #24).

## Options considered

### Option A — A separate database per business
- Pros: strongest isolation; easy per-business restore.
- Cons: thousands of databases to migrate, connect to and back up; cost grows with every signup.

### Option B — A separate schema per business (same database)
- Pros: good isolation.
- Cons: every migration runs once per business; schemas multiply; tooling gets complicated.

### Option C — Shared tables, a `business_id` on every row, enforced by PostgreSQL Row-Level Security (RLS)
- Pros: one schema, one migration, cheapest; RLS makes the database refuse other businesses' rows even when application code has a bug.
- Cons: a small per-query cost; RLS has gotchas that must be handled (below).

## Decision

Option C.

- Every business-owned table has a `business_id` column. Branch-level data also has a `branch_id`.
- RLS policies allow a row only when `business_id = current_setting('app.business_id')::uuid`.
- At the start of every transaction the API sets the business from the logged-in session with `set_config('app.business_id', $1, true)`. The `true` makes it transaction-local, and `set_config` is used because plain `SET` can't take query parameters.
- The app connects as a runtime role that does **not** own the tables and has no `BYPASSRLS`. Table owners and superusers skip RLS, so migrations run as a separate owner role. `FORCE ROW LEVEL SECURITY` is on as a backstop.
- Automated tests try to read and write across businesses and must fail.

## Why

Shared tables are the only option that stays cheap and simple as signups grow. RLS turns "every query must remember `WHERE business_id = …`" from a coding habit into a database guarantee: defense in depth.

## Consequences

- Every query runs inside a transaction that has the business set. A query outside one sees nothing, which fails safe.
- Background jobs set the business for each job before touching data.
- Connection pooling must use transaction pooling, so the setting never leaks to another request.
- Composite indexes start with `business_id`.
- Branch scoping and staff permissions are separate layers on top (see `docs/architecture.md`, "Who can see what").

## Interview note

I used a shared schema with a business_id on every row, which is cheap and simple, and backed it with PostgreSQL Row-Level Security so the database itself refuses another tenant's rows. The app connects as a role that doesn't own the tables, because owners and superusers bypass RLS, and it sets the tenant per transaction with a transaction-local setting. I have tests that deliberately try to read across tenants and expect to get nothing.
