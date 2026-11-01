# Phase 1 — Core selling

In progress. The detailed diary is `INTERVIEW_LOG.md`.

## What we built

- **2026-11-01 (P1.1 tenancy & data safety):** the first tables, `businesses` and `branches`, with Row-Level Security forced on, so even the owner role is filtered. The app reaches business data only through `withBusiness` (or `withNewBusiness` at signup), which sets the business for one transaction with `set_config(…, true)`. No business set means no rows and no inserts. A pooled connection reused after a transaction sees nothing, and a test proves it. IDs are UUIDv7 from PostgreSQL 18's `uuidv7()`. Signup sets the new business's ID before inserting it, so it passes the same policy with no bypass. A guard test reads PostgreSQL's catalogue and fails CI if any table breaks one of 8 rules (RLS, `FORCE`, the one correct policy, `business_id`, grants, business-scoped foreign keys, no materialized views); 16 probe tables prove it. The design was approved section by section; a fresh review found three leaks past the first guard and two `FORCE` traps (data migrations, `pg_dump`), all fixed or written down. 241 tests. ADR 0027.

## Stack choices vs alternatives

| Area | Chose | Over | ADR |
| --- | --- | --- | --- |
| IDs | UUIDv7 from `uuidv7()` | UUIDv4, serial integers | 0027 |
| Where RLS policies live | In the Drizzle schema via `tenantPolicy()`; `FORCE` and the function hand-written in the migration | All hand-written SQL; an event trigger | 0027 |
| Setting the business | `withBusiness` / `withNewBusiness` with a transaction-local `set_config` | `SET LOCAL`; a bypass role for signup | 0027 |
| Keeping future tables safe | A catalogue guard test with probe tables | Code review and a checklist | 0027 |

## Mistakes and what I learned

- **My type rule didn't hold until a test checked it.** `withBusiness` must not accept a transaction (the setting would outlive a savepoint), and a `@ts-expect-error` test showed TypeScript accepted one anyway: types match by shape, not name. Narrowed the parameter to a type only a real pool has. Lesson: "this must not compile" needs a test too.
- **My guard only caught the attacks I had thought of.** The reviewer showed three more on a live database: an extra permissive policy (policies are ORed), single-column foreign keys (foreign-key checks skip RLS) and a materialized view (never filtered). Lesson: a fresh attacker finds what the author can't; add a failing probe for each before fixing.
- **A safety setting had side effects I hadn't written down.** `FORCE` filters the owner role, so a data migration as the owner changes 0 rows silently, and `pg_dump` as the owner fails or writes empty tables. Lesson: for every safety feature, ask what else it stops.
- **I committed the plan before scanning it.** Scanned the commit straight after (clean). Lesson: the scan goes before every commit, docs included.

## Interview questions I can now answer

- Q: How does your app set the tenant, and what stops it leaking to the next request?
  A: `set_config('app.business_id', $1, true)` inside the transaction. `true` ends it with the transaction; on that connection it then reads as `''`, which my function turns into NULL, so the next request sees nothing until it sets its own business. (ADR 0027)
- Q: How do you create a tenant when the tenants table is itself protected by RLS?
  A: Generate the new ID first, set it as the current business, then insert. The row passes its own policy; no bypass role exists to protect. (ADR 0027)
- Q: How do you know every future table has RLS?
  A: A test reads the catalogue and fails CI on any table without RLS, `FORCE`, the one correct policy, `business_id`, the right grants or business-scoped foreign keys. Each rule is proven by a probe table that breaks it. (ADR 0027)
- Q: Can RLS alone stop a row pointing at another tenant's data?
  A: No: foreign-key checks skip RLS. Keys between tenant tables are composite, `(business_id, branch_id) → branches(business_id, id)`. (ADR 0027)
- Q: What does `FORCE ROW LEVEL SECURITY` change, and what does it break?
  A: Table owners skip RLS without it. With it, the owner is filtered too, so data migrations must lift it inside their transaction, and backups need a `BYPASSRLS` role, or `pg_dump` fails or comes out empty. (ADR 0027)
