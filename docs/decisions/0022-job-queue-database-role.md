# 0022 — Job-queue database role: pg-boss gets its own role and schema

- **Date:** 2026-10-30
- **Status:** Accepted (built in P2.7)

## Context

ADR 0010 chose pg-boss, a job queue stored in PostgreSQL, for background jobs in the `worker`. ADR 0007 says the app's runtime role can never delete rows, and ADR 0019 gives `app_runtime` only `SELECT, INSERT, UPDATE` on tables.

Facts found in pg-boss 12.38's SQL on 2026-10-30:
- On `start()` it creates its own schema (`pgboss`) and runs its own schema migrations.
- It creates tables **while running**, not only on install: a table per partitioned queue (`CREATE TABLE … (LIKE pgboss.job)` inside `create_queue`) and monthly `queue_stats` partitions.
- It **deletes** rows during maintenance (finished jobs, old stats, schedules).
- None of its functions are `SECURITY DEFINER`, so the role that calls it needs these rights itself.

So whichever role runs pg-boss needs `CREATE` and `DELETE` in its schema. The question from P0.4: who owns that schema, and how does "the runtime role never deletes" apply?

## Options considered

### Option A — A separate role `app_queue` that owns only schema `pgboss` (chosen)
- Pros:
  - pg-boss runs exactly as designed (creates its tables, migrates itself on upgrade, deletes old jobs), but only inside its own schema.
  - `app_queue` has no rights on business tables.
  - `app_runtime` has no rights on `pgboss`.
  - "The runtime role can't delete business rows" stays literally true.
- Cons:
  - A third app role in the bootstrap.
  - The worker holds two pools: `app_runtime` for business data, `app_queue` for pg-boss.

### Option B — `app_owner` installs pg-boss's SQL in a Drizzle migration; `app_runtime` gets `DELETE` on `pgboss.*` only
- Pros: one runtime role.
- Cons:
  - Breaks as soon as pg-boss creates a table at run time (partitioned queues, stats partitions), because the runtime role can't create tables.
  - Every pg-boss upgrade would need its migration SQL copied into a hand-made migration.

### Option C — Give `app_runtime` `CREATE` on schema `pgboss` and `DELETE` there
- Pros: pg-boss works with one role.
- Cons:
  - The role that touches business data could also create tables.
  - The tables it creates would be owned by it, and owners bypass Row-Level Security on their own tables. That blurs the rule ADRs 0006 and 0007 depend on.

## Decision

1. The bootstrap creates role `app_queue` (`LOGIN`, no superuser, `BYPASSRLS`, `CREATEROLE` or `CREATEDB`). As administrator, it also runs `CREATE SCHEMA pgboss AUTHORIZATION app_queue` and grants `CONNECT` on the database. No other grants.
2. pg-boss runs only in the `worker`, connected as `app_queue`.
3. The API never talks to pg-boss. Business actions insert outbox rows in `public` in their own transaction (ADR 0010), and the worker turns them into jobs.
4. Queue rows are not business records. The outbox table in `public` keeps the permanent history of every message (its status, attempts and errors), and nobody can delete it.
5. **Built in P2.7**, when the first job exists. Integration tests then prove that `app_queue` can't read `public` tables and `app_runtime` can't touch `pgboss`.

## Why

pg-boss needs table-creation and delete rights by design. Giving those rights to a role that can see only the queue keeps the blast radius to scratch data, and leaves the business-data rules unchanged.

## Consequences

- RDS bootstrap (stage 5, before P2.7): if P2.7 hasn't happened yet, `app_queue` is added later with a small one-time script, run by hand as on day one. Note in `PROGRESS.md`.
- Moving an outbox row to a job and marking it sent isn't one transaction across the two roles. Delivery is at least once, as ADR 0010 already accepts, and sending is idempotent by notification ID.
- A pg-boss upgrade migrates its own schema when the worker starts. Read the release notes before upgrading.

## Interview note

My job queue, pg-boss, needs to create tables and delete finished jobs, but my app's database role must never delete anything. So pg-boss gets its own role that owns only a `pgboss` schema and can't see business tables, while the business data's role can't touch the queue. The permanent record of every message stays in an outbox table that nobody can delete from.
