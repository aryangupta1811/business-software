# 0046 — Alerts are raised and cleared in the same transaction as the change that causes them

- **Date:** 2026-11-22
- **Status:** Accepted

## Context

P2.7 part 2 adds the bell: the owner and the staff see which items are low or out of stock at their branch without checking (`07` #1, #4, #6, #7; design `docs/plans/2026-11-22-p2.7-alerts-design.md`). `07` #4 says an alert is raised once and clears by itself, and `07` #6 says each person can dismiss it for themselves. So an alert is something the app must remember, not only compute. Every stock change already goes through `moveStock`, which knows each line's balance before and after inside the transaction, and an item's low-stock level is written by the item's own save.

## Options considered

### Option A — Raise and clear in the same transaction as the change (chosen)
- Pros: the alert can never disagree with the stock, because both commit together or neither does. It writes only when a line crosses a threshold or changes what the bell shows, and nothing otherwise. No worker is involved, so alerts work with the worker stopped.
- Cons: a few extra reads in every stock change (the levels and the open alerts of the items touched), and each place that changes what an alert depends on must call it (`moveStock`, the level save, archive and restore). A forgotten caller leaves a stale alert until the next stock change of that item.

### Option B — Through the outbox and the worker
- Pros: the stock change stays slightly lighter; the same path will carry WhatsApp messages.
- Cons: alerts arrive late and only while the worker runs, and the stock and its alert can disagree for a while or for good if a job is lost. It needs the worker's cross-business read, which isn't designed yet (P2.8). The outbox is for talking to the outside world; the bell is the app's own data.

### Option C — Worked out when someone looks
- Pros: nothing to keep in step; nothing can go stale.
- Cons: with no row there is nothing to remember "raised once" or a dismissal against, so `07` #4 and #6 can't be met without inventing the row anyway. Every poll of the bell would compare every item's stock with its level, and history (for the daily summary and the dashboard) would not exist.

## Decision

`alerts` (branch-level, composite keys, RLS, never deleted) holds one row per alert; `alert_dismissals` holds who dismissed which row. `syncStockAlerts` (`packages/db/src/alerts.ts`) compares each item's stock and level with its open alert using two pure functions in `packages/shared` (`stockAlert`, `raiseOrClear`) and raises, changes or clears it. `moveStock` calls it for the items it moved, the item save calls it when a level changed, and archive and restore call it, all inside their own transaction. Raising and clearing write no entry-log rows: the change that caused them is already one.

- **One open alert per subject, branch and family** is a partial unique index on `(business_id, branch_id, subject_type, subject_id, family) where cleared_at is null`. `family` is stored (`stock` for both `low_stock` and `out_of_stock`) and a check ties each type to its family, so low and out of stock are one alert that changes type (question 3A) and the database refuses a second open one. A cleared alert keeps its row, and a new one after it is a new row, so an old dismissal doesn't hide it (question 2A).
- **The app switches** are `businesses.alert_types`, a text array of the types the app shows, like `features`, with a check against the list. A type left out is hidden, not dropped: alerts keep being recorded.
- **Items nothing has moved at a branch have no stock row, so no alert.** Items with no low-stock level get out-of-stock only (`07` #17).

## Why

- **Correct by construction.** Whatever the stock says, the bell says, including after a rollback (a test fails the action after the alert was raised and finds neither).
- **Cheap where it counts.** Lines that don't cross anything write nothing; the extra reads use the item and branch already locked.
- **Time-based alerts fit later.** Expiry and overdue udhaar have no change to hang on; a daily worker job will call the same functions.

## Consequences

- Any new code that changes an item's stock or level must go through `moveStock` or call `syncStockAlerts`; the tenancy of the table is checked by the existing guard test.
- Alerts that already should exist when this migration runs (stock already under its level) are raised by the next stock change or level save of that item, not by the migration.
- Low becoming out of stock is the same row. ~~So someone who dismissed the low alert does not see it again as an out-of-stock alert.~~ **Changed 2026-11-22 (owner, `07` #19):** a dismissal now remembers the type the alert had (`alert_dismissals.dismissed_type`, migration 0016), and the bell hides the alert only while it is no worse than that (`ALERT_SEVERITY`: out of stock is worse than low). So a dismissed low alert shows again when the item runs out, and an alert dismissed at out of stock stays hidden when the item is back to low. It is a read rule in the list query, not something `syncStockAlerts` writes, so the app's no-delete rule still holds: dismissing again updates the one row.
- Counting and listing read open rows through the same index that enforces uniqueness.

## Interview note

I keep an alert as a row, raised and cleared inside the same database transaction as the stock change that causes it, so the bell can't disagree with the stock and a failed bill leaves no alert behind. I rejected sending it through the outbox and worker (late, and it can drift from the stock if a job is lost) and computing it on every look (no place to remember "raised once" or a dismissal). A partial unique index, one open alert per item, branch and family, lets the database itself refuse a duplicate while keeping every cleared alert as history.
