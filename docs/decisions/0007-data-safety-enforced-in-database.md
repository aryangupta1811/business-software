# 0007 — Data-safety rules enforced by the database

- **Date:** 2026-10-29
- **Status:** Accepted

## Context

Zero data loss is the top requirement (`product-overview.md` NFR 1): business records are never hard-deleted, a bill and its stock and udhaar changes save together or not at all, and every change is logged. Several counters bill at once (NFR 3). Stock changes only through recorded actions (Module 01 #10–11). Bills keep the details they were printed with (Module 00 #11). Every action is recorded against the logged-in person (Module 00 #20).

## Options considered

### Option A — Enforce the rules in application code only
- Pros: simpler setup.
- Cons: one bug, one forgotten check or one manual query can break them.

### Option B — Enforce them in the database too, wherever the database can
- Pros: the rules hold even when code is wrong; easy to explain and to test.
- Cons: two database roles to manage; a little more care in migrations.

## Decision

Option B. These rules apply to all modules:

1. **No hard deletes.** The runtime database role has no `DELETE` permission on business tables. Mistakes are fixed by cancelling or reversing, with a reason.
2. **The entry log is append-only.** The runtime role has only `INSERT` and `SELECT` on it. Nobody can edit or delete a log row.
3. **One transaction per business action.** A bill, its stock movements, its udhaar entry, its log rows and any outgoing notifications (ADR 0010) commit together or not at all.
4. **Stock is a ledger.** Every change is a row in a stock-movements table. The current-stock row is updated in the same transaction, under a row lock.
5. **Invoice numbers come from a locked counter row** per branch per financial year, inside the bill transaction. No duplicates and no gaps. A database sequence is not used because it skips numbers on rollback.
6. **Locks are taken in a fixed order** (by item ID) so two bills can't deadlock.
7. **Idempotency keys** on every create request from the screen. A retried request returns the original result.
8. **Snapshots:** a bill stores the business details, prices and tax it was printed with.
9. **Migrations are never destructive** without the owner's OK and a fresh backup (`CLAUDE.md` rule 7).

- **Dated note 2026-11-20 (P1.8, design `docs/plans/2026-11-20-p1.8-stock-ledger-design.md`):** rule 4 is built as `stock_movements` (append-only: the migration revokes `UPDATE`, and the guard's `APPEND_ONLY` list includes it) plus `item_stock`, one row per item per branch with the quantity and the average cost (Module 01 #4, kept per branch). `moveStock(tx, …)` in `packages/db/src/stock.ts` is the only code that writes either. Rule 6: it locks the items `FOR SHARE` and then their stock rows `FOR UPDATE`, both sorted by item ID, so two calls with the same items in any order can't deadlock (tested). Rule 7: a `request_key` on the movement, unique per business; a retry answers the first movement, the same key for a different change answers `422 key_reused`. `findStockMismatches` checks every total against the sum of its movements and its last balance. Lock waits are limited by ADR 0041.
- **Dated note 2026-11-24 (P1.18, ADR 0050):** the udhaar ledger follows the same pattern: `udhaar_entries` is append-only (UPDATE revoked, on the guard's list) and `udhaar_accounts` holds one balance row per customer, written only by `moveUdhaar(tx, …)`; `findUdhaarMismatches` is its check. Rule 6 as built in a bill save: the invoice counter row first, then the items' stock rows (by item ID), then the customer's udhaar account last. A payment takes only the account. Rule 7: a payment's or opening's `request_key` is unique per business, and a bill's udhaar and advance entries are unique per bill, so a retry never counts twice.

## Why

Code will have bugs, so the database is the last line of defense. These rules are also the strongest interview material in the project.

## Consequences

- Two roles: a migration role that owns the schema, and a runtime role with limited grants (shared with ADR 0006).
- "Delete" in the UI means archive or deactivate (e.g. staff logins, items), and lists filter out archived rows.
- A future privacy request to erase personal data (India's DPDP Act) will mean anonymising personal fields and keeping the financial records. To decide when it comes up.
- Tests cover each rule: a delete attempt fails, two counters selling the last unit, a retry with the same key, a rollback halfway through a bill.

## Interview note

I enforce the zero-data-loss rules in PostgreSQL itself: the app's database user can't delete business rows, the audit log is insert-only, and stock is a ledger of movements rather than a number that gets overwritten. Every business action is one transaction, invoice numbers come from a locked counter so there are no gaps or duplicates, and idempotency keys make retries safe. So even a bug in my code can't silently lose or duplicate a bill.
