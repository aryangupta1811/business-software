# 0028 — Entry log: one append-only row per action, `before`/`after` JSON, actor without a key until P1.4

- **Date:** 2026-11-01
- **Status:** Accepted (table shape); the write helper's details are finished in `docs/plans/2026-11-01-p1.2-entry-log-design.md`

## Context

ADR 0007 says the entry log is append-only and commits with the action it describes. Module 00 #20 says every action is recorded against the logged-in person; Module 01 #11 says stock adjustments carry a reason. P1.2 builds the recording side before any feature needs it, because a log added later is missing the early history. Two things had to be decided: how a row says who did it when there is no users table yet (P1.4), and how it stores old → new values.

## Options considered

### Who did it

#### Option A — `actor_id` uuid, nullable, no foreign key yet (chosen)
- Pros: small; P1.4 adds the users table and a migration adds the composite key; NULL gives the system (e.g. the worker) a clear meaning. No real data exists before DevOps stage 5, so adding the key later is safe.
- Cons: until then the database can't check that the ID is a real user.

#### Option B — A minimal `users` table now
- Cons: pulls P1.4's design (passwords, sessions, roles) into this task.

#### Option C — A free-text name
- Cons: weak evidence; names are renamed and duplicated.

### Old value → new value

#### Option 1 — Two `jsonb` columns, `before` and `after` (chosen)
- Pros: one row per action; the writer stays simple; the viewer (P2.6) can diff the two.
- Cons: finding "every price change" means filtering on `action` and reading JSON, not on a column.

#### Option 2 — One row per changed field
- Cons: one action becomes many rows; a 20-line bill becomes a pile.

#### Option 3 — A single `changes` JSON like `{price: [10, 12]}`
- Cons: every module must compute the diff, and a mistake there silently corrupts the history.

## Decision

- Table `entry_log`: `id` (UUIDv7), `business_id` (default `app_current_business_id()`), optional `branch_id` (composite key to `branches`), nullable `actor_id`, `action` (text), `entity_type`, `entity_id`, optional `reason`, optional `before` and `after` (`jsonb`), `created_at`.
- `action` is plain text, not a database enum, so a new action needs no migration. The allowed names are a TypeScript type, so a typo fails type-checking.
- It is a normal tenant table (ADR 0027): `tenantPolicy`, `FORCE ROW LEVEL SECURITY`, the guard test.
- Append-only: the migration runs `REVOKE UPDATE ON entry_log FROM app_runtime`; DELETE and TRUNCATE are already absent from the default privileges (ADR 0019). A test proves `UPDATE`, `DELETE` and `TRUNCATE` fail with `42501`.
- Rows are kept forever for now (revisit at `/finalize-module 06`).

## Why

The database, not the code, makes the log trustworthy (ADR 0007). Keeping the table plain (text actions, JSON values, a nullable actor) lets every module write to it from day one without a migration per action, and lets P1.4 tighten the actor later.

## Consequences

- P1.4 must add a migration: a composite foreign key from `entry_log` to the users table (`(business_id, actor_id) → users(business_id, id)`, with the unique key on users), and the guard's rules apply.
- `app_owner` can still update the table (it owns it). That is acceptable because it is the migration role and never runs at runtime; data migrations still must not touch log rows.
- JSON values hold money as integer paise (ADR 0008).

## Interview note

My audit log is one insert-only table. The app's database user has no UPDATE, DELETE or TRUNCATE on it, and a test proves each is refused with the permission error, so even a bug in my code can't rewrite history. Each row stores the old and new values as JSON and commits in the same transaction as the change it describes, so a rolled-back change leaves no log row, and a committed one can't miss it.
