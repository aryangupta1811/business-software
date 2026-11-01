# 0027 — Tenancy implementation: UUIDv7, policies in the schema, one way in, a guard test

- **Date:** 2026-11-01
- **Status:** Accepted

## Context

ADR 0006 chose shared tables with a `business_id` and PostgreSQL Row-Level Security; ADR 0007 put the data-safety rules in the database; ADR 0019 gave the runtime role SELECT, INSERT and UPDATE on every future table through default privileges. P1.1 creates the first tables (`businesses`, `branches`) and had to make four things concrete:

- what IDs look like (ADR 0001 says only "a UUID made at the source");
- where each table's policy is written, so it can't be forgotten;
- how code sets the business for a transaction, including at signup, before the business exists;
- how we know every future table follows the rules.

Design: `docs/plans/2026-11-01-p1.1-tenancy-design.md`.

## Options considered

### IDs

#### Option A — UUIDv7 from PostgreSQL 18's built-in `uuidv7()` (chosen)
- Pros: starts with a timestamp, so new rows append to the end of the primary-key index; still safe to create anywhere (offline later, ADR 0001); built into PostgreSQL 18, which runs everywhere (ADR 0005), so no extension or library.
- Cons: reveals the creation time to the millisecond. Fine for business records; secrets such as reset tokens use random bytes instead.

#### Option B — UUIDv4 (`gen_random_uuid()`)
- Cons: random values land all over the index, splitting pages and slowing inserts as tables grow.

#### Option C — serial integers
- Cons: collide when records are created offline; guessable and they reveal how many bills a shop has made.

### Where policies are written

#### Option A — Declared next to each table in the Drizzle schema through a helper (chosen)
- Pros: reading a table's definition shows its rule; `tenantPolicy(t.businessId)` is one line per table; `drizzle-kit generate` writes the policy and `ENABLE ROW LEVEL SECURITY` into the migration and records them in its snapshot.
- Cons: drizzle-kit 0.31 can't generate `FORCE ROW LEVEL SECURITY` (checked), so that line, and the function the policies call, are hand-written into the same migration.

#### Option B — All RLS hand-written in SQL migrations; Drizzle knows only the columns
- Pros: one place, plain SQL.
- Cons: the rule is invisible from the schema file, and Drizzle's snapshot doesn't know the policies exist.

#### Option C — An event trigger that switches on RLS for every new table
- Cons: needs superuser-level rights, which the app roles deliberately don't have, and behaves differently on RDS. It would also only switch RLS on, not write a correct policy.

### Setting the business for a transaction

#### Option A — `withBusiness(db, id, work)` and `withNewBusiness(db, work)` (chosen)
- Pros: one function opens the transaction and runs `set_config('app.business_id', $1::uuid::text, true)`: transaction-local, so a pooled connection can't carry it into the next request; the cast refuses a malformed ID at once. Signup gets a new `uuidv7()`, sets it, then inserts, so the policy's own check passes and nothing needs a bypass.
- Cons: every data access must go through one of them. Forgetting fails safe: a tenant table outside them shows no rows and refuses inserts.

#### Option B — `SET LOCAL app.business_id = …`
- Cons: `SET` can't take query parameters, so the ID would be pasted into SQL text.

#### Option C — A bypass role (or `SECURITY DEFINER` function) for signup
- Cons: a second way past RLS that has to be guarded, for a problem that ordering solves.

### Making sure every table follows the rules

#### Option A — A guard test over PostgreSQL's catalogue (chosen)
- Pros: one test reads `pg_class`, `pg_policy`, the column list, the grants and the foreign keys, and lists every table in `public` with RLS off or not forced, no correct `tenant_isolation` policy or an extra permissive one, no `business_id`, more than SELECT/INSERT/UPDATE for `app_runtime` or PUBLIC, a `branch_id` without the composite foreign key `(business_id, branch_id) → branches(business_id, id)`, or any foreign key into another tenant table that doesn't pair `business_id` with `business_id`. It also refuses materialized views and foreign tables in `public`, which RLS never applies to. A forgotten table fails CI. The test proves itself with one deliberately broken probe table per rule.
- Cons: an honest non-tenant table will need an entry in an exceptions list, with its reason.

#### Option B — Code review and a checklist
- Cons: relies on remembering, which is exactly what fails once.

## Decision

- IDs are UUIDv7 from `uuidv7()`.
- Tenant tables declare `tenantPolicy(column)` in `packages/db/src/schema.ts`: one permissive policy for all commands, to PUBLIC, with `column = (select app_current_business_id())` in both `USING` and `WITH CHECK`. Migrations add `FORCE ROW LEVEL SECURITY` and the function by hand.
- `app_current_business_id()` is a plain `STABLE` SQL function (not `SECURITY DEFINER`) returning `nullif(current_setting('app.business_id', true), '')::uuid`.
- Tenant data is reached only through `withBusiness` and `withNewBusiness` (`packages/db/src/tenancy.ts`).
- Every foreign key into another tenant table (other than `businesses`) is composite and pairs `business_id` with `business_id`, e.g. `(business_id, branch_id) → branches(business_id, id)`, because foreign-key checks skip RLS. So every table that is referenced has `unique (business_id, id)`, like `branches`.
- `src/tenancy-guard.test.ts` enforces all of this on every test run.

## Why

The database is the guarantee (ADR 0006), and the guard test guarantees that the database is set up to give it, for every table, including ones written months from now. The `nullif` and the transaction-local setting make "no business set" mean "see nothing", never "error" or "see everything". The composite foreign key closes a gap RLS leaves open: RLS checks each row's own `business_id`, not what the row points at.

## Consequences

- Every new tenant table: `businessId()`, `tenantPolicy(…)`, and `FORCE` added in its migration. The guard test fails until all three are there.
- **`FORCE` filters the migration role too.** A data migration (an `UPDATE` or backfill) run as `app_owner` with no business set changes **0 rows, with no error**: a later "copy the column, then drop the old one" migration would lose data. A data migration must, inside its own transaction, `ALTER TABLE … NO FORCE ROW LEVEL SECURITY`, run the statement, then `FORCE` again (DDL is transactional), or run per business with `set_config`, and its test must check the row count.
- **`pg_dump` as `app_owner` fails** ("query would be affected by row-level security policy"), and with `--enable-row-security` it exits 0 and writes **empty** tables. Backups (ADR 0011, DevOps stage 7) must run as a role with `BYPASSRLS` (or the RDS master user), never with `--enable-row-security`, and the restore drill must check row counts.
- No materialized views or foreign tables for tenant data: RLS never applies to them (the guard refuses them).
- After a transaction-local setting ends, PostgreSQL reads it back as `''` on that connection; the function's `nullif` handles it, and a test reuses one pooled connection to prove it.
- Querying tenant tables by hand (psql) shows nothing until `select set_config('app.business_id', '<id>', false)` is run (`docs/devops/local-database.md`).
- P1.4 must look up a user's business at login, before any business is set: probably a narrow `SECURITY DEFINER` function with PUBLIC's EXECUTE revoked. Decided there.
- P2.7's worker calls `withBusiness` per job, with the business stored in the job.

## Interview note

Every tenant table gets its RLS policy from one helper in the schema, and a test scans PostgreSQL's catalogue so a table without RLS, `FORCE`, a correct policy, the right grants or business-scoped foreign keys fails CI. Code sets the business with a transaction-local `set_config`, and a missing or reset setting means no rows, so a pooled connection can't leak one shop's data into the next request. Signup sets the new business's ID before inserting it, so even creating a business goes through the same policy with no bypass.
