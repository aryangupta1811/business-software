# 0050 — Udhaar is a ledger with one locked balance row per customer; "oldest bills first" is computed when read

- **Date:** 2026-11-24
- **Status:** Accepted

## Context

Module 03 (decided 2026-11-17, P1.18 design `docs/plans/2026-11-23-p1.18-udhaar-design.md`) needs a running balance per customer, partial payments at any time, payments that clear the oldest bill first (`03` #4), an advance when someone overpays (`03` #6), credit limits and an owner-only correction for a payment made by mistake. ADR 0007 already says every business action is one transaction, nothing is deleted, locks are taken in a fixed order, and a retry returns the first result. ADR 0047 makes saved bills append-only. The next features (overdue buckets, reminders, the statement PDF, bill cancellation) all read the same data, so it has to be right and cheap to read.

## Options considered

### Option A: a ledger of entries plus one locked balance row per customer; unpaid bills computed from the ledger
- Every change is an append-only row in `udhaar_entries` (a bill, an advance used, a payment, a payment reversal, an opening balance) with its `balance_after`. `udhaar_accounts` holds the balance, and one function, `moveUdhaar`, is the only writer (like `moveStock`). Which bills are still unpaid is not stored: the newest entries above zero that add up to the balance are unpaid, everything older was paid. One tested function in `packages/shared`, `unpaidEntries`, holds that rule.
- Pros: the balance can't drift from the entries (a check function compares them, like `findStockMismatches`); a reversal or a cancelled bill needs no bookkeeping beyond its own entry; the buckets, the reminder list and the statement call the same function.
- Cons: the unpaid list is computed on read from all of a customer's entries, fine at a shop's size.

### Option B: also store which payment cleared which bill (an allocations table)
- Pros: the unpaid list is a plain query.
- Cons: the table has to be kept right through every payment, reversal and cancellation; a bug there makes the overdue buckets wrong without any error.

### Option C: no balance row, the balance is the sum of the entries on every read
- Pros: nothing to keep in step.
- Cons: nothing to lock, so two counters adding to one customer at once could both pass a credit-limit or advance check against the same old balance.

## Decision

Option A. The migration (`0019`) revokes `UPDATE` on `udhaar_entries` (on the guard's append-only list); `udhaar_accounts` is updated in place under its row lock, like `item_stock`. A bill's udhaar part and its advance part are entries with the bill's ID, unique per bill and kind, so a retry can't count twice. A payment's `request_key` is unique per business. A payment recorded by mistake is reversed by the owner with a reason (`payment_reversal`, unique per payment); the payment stays and `unpaidEntries` leaves a reversed payment and its reversal out, so the bill it had cleared is owed again with its own due date. Due dates are fixed when the entry is made (`03` #22). The credit limit and due days are changed only by the owner (`03` #24, refused at the API).

**Lock order.** ADR 0007 rule 6 names the items; the real order of a bill save is fixed by the code in `apps/api/src/bills/bills.service.ts`: the invoice counter row, then the items' stock rows (sorted by item ID), and the customer's udhaar account last, after `moveStock`. The design draft had the order the other way round; the code's order is kept. It can't deadlock: a payment takes only the account, and no path takes the account and then something else. A bill reads the locked balance, then decides the credit limit (the owner's OK, if needed, is checked on the same locked balance), then writes its entries; any refusal rolls the whole save back, number and stock included.

## Why

It puts the same guarantees on money owed that ADR 0007 puts on stock: one writer, one lock, an append-only history and a check that compares the two. Computing "oldest first" on read keeps the ledger as the single source of truth.

## Consequences

- `moveUdhaar`, `lockUdhaarAccount` and `findUdhaarMismatches` live in `packages/db/src/udhaar.ts`; `unpaidEntries` and `creditLimitVerdict` in `packages/shared/src/udhaar.ts`. Tests run the mismatch check after every udhaar test.
- A bill can need two owner approvals (a discount and a credit limit), so `bills` has `credit_approval_id` (unique) beside `approval_id`.
- An opening balance (the old notebook) is only taken before a customer's first entry, so it is always the oldest.
- P1.16 (cancel a bill) adds a `bill_cancelled` entry kind; P1.19 reads `unpaidEntries` for the buckets and reminders.

## Interview note

"Udhaar is a ledger, not a number I overwrite. Each customer has one balance row that bills and payments lock, and an append-only list of entries that each record the balance after them. A check function proves the balance equals the sum of the entries. I didn't store which payment cleared which bill, because a stored allocation can silently drift; I compute 'oldest bills first' from the ledger when it's read. Two counters adding to the same customer at once are serialised by the row lock, and I took the locks in one fixed order so a bill can't deadlock with a payment."
