# Phase 1 — Core selling

In progress. The detailed diary is `INTERVIEW_LOG.md`.

## What we built

- **2026-11-01 (P1.1 tenancy & data safety):** the first tables, `businesses` and `branches`, with Row-Level Security forced on, so even the owner role is filtered. The app reaches business data only through `withBusiness` (or `withNewBusiness` at signup), which sets the business for one transaction with `set_config(…, true)`. No business set means no rows and no inserts. A pooled connection reused after a transaction sees nothing, and a test proves it. IDs are UUIDv7 from PostgreSQL 18's `uuidv7()`. Signup sets the new business's ID before inserting it, so it passes the same policy with no bypass. A guard test reads PostgreSQL's catalogue and fails CI if any table breaks one of 8 rules (RLS, `FORCE`, the one correct policy, `business_id`, grants, business-scoped foreign keys, no materialized views); 16 probe tables prove it. The design was approved section by section; a fresh review found three leaks past the first guard and two `FORCE` traps (data migrations, `pg_dump`), all fixed or written down. 241 tests. ADR 0027.
- **2026-11-02 (P1.2 entry log recording):** the audit log, built before any feature changes data so no history is missing. One tenant table, `entry_log`, that the app's database user can only insert into and read: the migration revokes UPDATE, and DELETE was never granted. Each row has who (`actor_id`, NULL = the system; the key to users waits for P1.4), what (`action`, `entity_type`, `entity_id`), why (`reason`) and old → new (`before`/`after` JSON). One helper, `recordEntry(tx, entry)`, takes a transaction, not the database, so the row commits or rolls back with its action; it refuses a stock adjustment without a reason and a missing actor. The guard grew from 8 to 11 table rules plus function and role checks, now over every schema and over effective (inherited and column-level) rights, proven by 28 probes. A fresh review found five more ways to reopen the log or leak data, all fixed test-first. 262 tests. ADR 0028.
- **2026-11-02 (Module 00 open questions, no code):** settled the rules signup and login depend on, before designing their tables.
  - Owner auto-lock: 5 minutes, settable from 1 to 30. A staff session ends after 30 idle minutes.
  - The owner logs in with email. Staff log in with a username that only has to be unique within the shop, because the counter computer remembers which shop it belongs to.
  - A forgotten owner password is reset by an email link or a printed recovery key. The owner resets staff passwords.
  - Staff who leave are deactivated, never deleted. Each staff member has one home branch.
  - Signup gained the owner's email (6 fields).

## Stack choices vs alternatives

| Area | Chose | Over | ADR |
| --- | --- | --- | --- |
| IDs | UUIDv7 from `uuidv7()` | UUIDv4, serial integers | 0027 |
| Where RLS policies live | In the Drizzle schema via `tenantPolicy()`; `FORCE` and the function hand-written in the migration | All hand-written SQL; an event trigger | 0027 |
| Setting the business | `withBusiness` / `withNewBusiness` with a transaction-local `set_config` | `SET LOCAL`; a bypass role for signup | 0027 |
| Keeping future tables safe | A catalogue guard test with probe tables | Code review and a checklist | 0027 |
| Who did it, before users exist | Nullable `actor_id`, key added in P1.4 | A minimal users table now; a free-text name | 0028 |
| Old → new values | Two jsonb columns, `before` and `after` | One row per changed field; a precomputed diff | 0028 |
| Action names | Text column + a TypeScript list | A database enum (a migration per new action) | 0028 |
| Owner password reset (product rule) | Email link + printed recovery key | SMS OTP (per-message cost, DLT registration); recovery key only | Module 00 #30–#33 |
| Staff login (product rule) | Username unique within the shop; the counter computer remembers the shop | A shop code typed at every login; usernames unique across the app | Module 00 #28 |

## Mistakes and what I learned

- **My type rule didn't hold until a test checked it.** `withBusiness` must not accept a transaction (the setting would outlive a savepoint), and a `@ts-expect-error` test showed TypeScript accepted one anyway: types match by shape, not name. Narrowed the parameter to a type only a real pool has. Lesson: "this must not compile" needs a test too.
- **My guard only caught the attacks I had thought of.** The reviewer showed three more on a live database: an extra permissive policy (policies are ORed), single-column foreign keys (foreign-key checks skip RLS) and a materialized view (never filtered). Lesson: a fresh attacker finds what the author can't; add a failing probe for each before fixing.
- **A safety setting had side effects I hadn't written down.** `FORCE` filters the owner role, so a data migration as the owner changes 0 rows silently, and `pg_dump` as the owner fails or writes empty tables. Lesson: for every safety feature, ask what else it stops.
- **I committed the plan before scanning it.** Scanned the commit straight after (clean). Lesson: the scan goes before every commit, docs included.
- **"Can the app UPDATE this table?" has more than one answer.** My append-only check asked `has_table_privilege(…, 'UPDATE')`. The reviewer showed three other ways in: a column-level grant (`has_any_column_privilege` is true), a plain view (it checks rights as its owner, who owns the log), and a `SECURITY DEFINER` function granted to the app. Lesson: guard the outcome ("can app_runtime change a row?"), not the one grant I imagined.
- **A type isn't a runtime check.** `actorId: string | null` makes forgetting "who" a compile error, but untyped code can still pass `undefined`, which became NULL, meaning "the system". One line at runtime closes it.
- **A test helper pointed at the wrong database.** The superuser URL named the container's default database, so a schema probe "didn't exist". Lesson: when a setup step fails, check where it ran before changing the test.
- **The list of open questions wasn't complete.** Answering "how to reset a password" (by email) made email a login detail, and that exposed a question nobody had listed: what owners and staff type to log in. Lesson: after answering each question, ask what it changes downstream.

## Interview questions I can now answer

- Q: How do you make an audit log tamper-proof for the app?
  A: The app's role has only INSERT and SELECT, a test proves UPDATE, DELETE and TRUNCATE fail with `42501`, and a guard fails CI if any route back opens up: column grants, views without `security_invoker`, or definer functions the app can call. (ADR 0028)
- Q: Why does the log helper take a transaction instead of the database?
  A: So it can't commit separately: a rolled-back action leaves no log row, and a committed one can't be missing it. (ADRs 0007, 0028)
- Q: Two entries in one transaction have the same timestamp. How do you order them?
  A: `now()` is the transaction's start time. I order by the UUIDv7 id, which increases within a session. (ADR 0028)
- Q: How does a shop owner recover a forgotten password with no phone app?
  A: An emailed reset link once the email is confirmed, plus a recovery key printed at signup. SMS OTP was rejected because it costs money per message and needs DLT registration in India. (Module 00 #30–#33)

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
