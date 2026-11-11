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
- **2026-11-10 (deep scan, before opening the AWS account):** a full read of the code, the migrations, the pipeline and the plan, plus 18 attacks on a live database as the app's own role. Tenant isolation and the no-delete rules held. Four bugs were in how the API fails, not in what it does, and each got a failing test first:
  - A database connection lost in the middle of a transaction crashed the whole API process.
  - Any request failing on a query would have logged the query's values (customers' data), because Nest's default error handler logs the error object.
  - An error nothing caught was printed by Node as a whole object, skipping the messages-only rule.
  - The log gave no reason at all when `localhost` refused the connection.

  The plan had gaps too, now filed under their tasks in `PROGRESS.md`: the worker can't see any business's rows without a cross-business read; the public demo login and its "reset" clash with the no-delete rule; login isn't the only lookup that happens before a business is known. 272 tests.
- **2026-11-10 (plan and technology review, no feature code):** every technology checked with evidence (`docs/plans/2026-11-10-plan-review.md`). The stack stays. Experiments corrected four assumptions: pg-boss needs `createSchema: false` to run as its restricted role; the Graviton server is ARM64 while CI builds x86 images (both images were built and run on ARM64); tests don't need the SWC plugin; Argon2id is built into Node 24. The order of work changed to **demo-first**: cloud stages 5, 6 and 7 before any feature, then the shortest path to a printed bill, then demo data, then the rest.

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
- **I had tested the idle half of a failure and assumed the other half.** A test killed the database's *idle* connections and the API survived, so I believed a database restart was covered. pg-pool removes its `error` listener from a connection the moment it's checked out, and every transaction checks one out. Lesson: for each failure, ask what state the system is in when it happens, and test the busy state too.
- **A rule I wrote down wasn't the framework's default.** "Never log the error object" was in `secrets.md` and in my own code, but the first unexpected error in a request would have gone through Nest's handler, which logs exactly that. Lesson: a rule about logging has to be enforced at every exit: my code, the framework's handler and the runtime's crash report.

## Interview questions I can now answer

- Q: What happens to your API when the database restarts in the middle of a request?
  A: That request fails with a 500 and the process keeps running. It used to crash: pg-pool listens for `error` only on idle connections, and Node kills a process on an `error` event with no listener. I listen on every connection the pool opens, and a test terminates the backend mid-transaction to prove it. (`packages/db/src/client.ts`)
- Q: How do you keep customer data out of your logs?
  A: Only messages are logged, never error objects. A failed query's error carries its values and PostgreSQL's `detail` line, and Nest's default handler logs the whole object, so I replaced it with a filter that logs one line and answers a plain 500. The same rule covers startup failures and uncaught errors. (`docs/devops/secrets.md`)
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
