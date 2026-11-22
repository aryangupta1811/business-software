# 0047 — Saved bills are append-only; a cancellation is its own row, never a change to the bill

- **Date:** 2026-11-22
- **Status:** Accepted

## Context

P1.14 saves bills (design `docs/plans/2026-11-22-p1.14-save-bill-design.md`). Module 02 #14 says a saved bill is never edited: a mistake is fixed by cancelling it or issuing a credit note (P1.16). Zero data loss is the top non-functional requirement (`product-overview.md`), and ADR 0007 asks the database, not only the code, to enforce the rules that protect records. The entry log (ADR 0028) and the stock ledger (ADR 0007, P1.8) are already append-only: the migration revokes `UPDATE` from `app_runtime`, `DELETE` was never granted, and the guard test's `APPEND_ONLY` list fails the build if either comes back.

A bill is also a legal document. Its number, seller and buyer details and amounts must read the same years later, even after the item, the customer or the branch has been edited.

## Options considered

### Option A — append-only `bills`, `bill_lines`, `bill_payments`; P1.16 cancels with a row in its own table
- Pros: the database refuses any change to a saved bill, whatever the code does (`42501`). Same pattern as the entry log and stock ledger, so the guard test covers it with one list entry per table. A bill's history is a list of rows, which is easy to audit and explain.
- Cons: "is this bill cancelled?" becomes a join (or `exists`) instead of a column. P1.16 needs its own table.

### Option B — a `status` / `cancelled_at` column on `bills`, with `UPDATE` granted on that one column
- Pros: cancelling is one `update`; reading the state is one column.
- Cons: a column grant is easy to widen by accident in a later migration, and the guard test would have to tell "this column only" apart from any other UPDATE right. Who cancelled and why would still need its own place. The bill row stops being a fixed copy of what was printed.

### Option C — editable bills with a version history table
- Pros: corrections look like edits to the user.
- Cons: the opposite of Module 02 #14 and of GST practice (a correction is a credit note with its own number). The app could change a printed bill's totals, and only code would stop it.

## Decision

Option A. `bills`, `bill_lines` and `bill_payments` are append-only (`REVOKE UPDATE` in migration `0017`; on the guard's `APPEND_ONLY` list). A saved bill stores its own copies of everything printed on it: the invoice number built at saving (`00` #61), the seller's details (`seller` jsonb), the buyer's (`buyer` jsonb), and each line's name, unit, HSN, rate and amounts. P1.16 records a cancellation as a row in its own table that points at the bill. The invoice counter (`invoice_counters`) is not a record but a counter, so it is updated in place, locked by the bill's own transaction (ADR 0007 rule 5).

## Why

- The database enforces "never edited", as ADR 0007 asks: a bug, a wrong query or a later feature can't change a saved bill.
- One rule for every record table (entry log, stock movements, bills): easy to explain, and one guard test checks it.
- Copies on the bill mean a later edit to an item, customer or branch never changes an old bill, which the law and the owner both expect.

## Consequences

- Reports that hide cancelled bills join to P1.16's table. Its index on `bill_id` keeps that cheap.
- Storing copies costs a little space per line; a shop's bills over years stay in the tens of megabytes.
- Anything a bill needs later (e.g. a printed QR code, P1.15) must be saved at the time of saving or derived from stored values, never added by an update.
- Data fixes, if ever needed, go through a reviewed migration as `app_owner`, not through the app.

## Interview note

A saved bill is a legal document, so I made the database refuse to change it: the app's role has no UPDATE or DELETE rights on the bill tables, and a test fails the build if that ever changes. A cancellation is a new row that points at the bill, the same pattern as my audit log and stock ledger. The trade-off is a join to see whether a bill was cancelled, which is cheap compared with a printed invoice that could silently change.
