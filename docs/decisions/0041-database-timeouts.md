# 0041 — Database timeouts for the app's connections

- **Date:** 2026-11-20
- **Status:** Accepted
- **Number:** 0041 follows lane 2's email ADR 0040 (fast track Day 4); it may be renumbered at merge if the order changes.

## Context

P1.8 adds the first row locks that two counters wait on: each item's stock row at a branch (ADR 0007 rules 4 and 6). Until now `app_runtime` had no limits, so a request waiting on another counter's lock, a runaway query, or a transaction a bug left open would wait for ever and hold one of the pool's 10 connections (found in the 2026-11-10 deep scan). Ten such requests and every counter in every shop stops. NFR 5 says a bill saves in under a second.

## Options considered

### Option A — `ALTER ROLE app_runtime SET …`
- Pros: holds for every connection as that role, whatever code opens it.
- Cons: changing a role's settings needs the RDS master user, so it's a hand-run step on every environment (like the role scripts), easy to forget and invisible in the code; tests would need it in the bootstrap too.

### Option B — Start-up parameters from `createDatabase`
- Pros: the values travel with the code in each connection's start-up message, so they hold before the first query; nothing to run by hand; a test reads them back through the real pool; tests can pass shorter values.
- Cons: a connection opened outside `createDatabase` (`psql`, a script) has none; migrations deliberately have none.

### Option C — `SET LOCAL` at the start of each transaction
- Pros: per transaction.
- Cons: an extra round trip per transaction, and any query outside `withBusiness` would have no limit.

## Decision

Option B. `createDatabase` sends `lock_timeout = 3s`, `statement_timeout = 10s` and `idle_in_transaction_session_timeout = 15s` (`APP_TIMEOUTS` in `packages/db/src/client.ts`). The API and the worker use it; `runMigrations` keeps its own pool without limits. A lock timeout (`55P03`) answers `503 { code: 'busy' }` with `Retry-After: 1` (`UnhandledErrorFilter`); the screen retries once with the same idempotency key. A statement timeout stays a `500` with one log line.

## Why

- **3 s for a lock:** a bill holds its stock rows for well under a second, so 3 s of waiting means something is stuck; a clear "busy, try again" beats a frozen counter.
- **10 s per statement:** nothing a counter runs comes close; it stops a runaway query from holding a connection.
- **15 s idle in a transaction:** a transaction left open by a bug is ended by the server, and its locks are released.
- Values in code are reviewed, tested and deployed like code; role settings are not.

## Consequences

- Tests prove each limit with short values (`client.test.ts`, `stock.test.ts`) and check the production values with `current_setting()`.
- Reports or exports that need a long query later must run on a separate pool with their own values, not by raising these.
- The worker's queue pool (ADR 0022, P2.7) decides its own values when it arrives.
- A manual `psql` session has no limits; that is intended for an operator.

## Interview note

Every app connection carries a lock timeout, a statement timeout and an idle-in-transaction timeout, sent at connect time from the code. A counter that loses a lock race for three seconds gets a 503 with Retry-After and retries with the same idempotency key, so nothing hangs and nothing is done twice. I chose start-up parameters over role settings so the limits are versioned and tested with the code, with no manual step on RDS.
