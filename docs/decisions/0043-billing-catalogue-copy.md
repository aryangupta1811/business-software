# 0043 — The billing counter's catalogue copy and its sync

- **Date:** 2026-11-21
- **Status:** Accepted

## Context

`product-overview.md` NFR 5: a scanned item must be on the bill in under 200 ms. NFR 3: several counters bill at once, and the owner edits items on another computer while they do. ADR 0032 measured 0.2 s per round trip to Sydney and said P1.13 must look items up in the browser. ADR 0033 moved to Mumbai (about 0.06 s), which made a lookup per scan possible on paper, and left the choice to P1.13. A shop's 4G or broadband still has jitter and the odd slow second, and a counter scans dozens of items a minute.

The P1.13 design (`docs/plans/2026-11-20-p1.13-billing-design.md` §4, §10) proposed a copy; the owner accepted the design's recommendations on 2026-11-21.

Two facts shape the sync:
- `items.updated_at` is set by the API (`new Date()`) when a change is **made**, but other counters only see it when its transaction **commits**, which can be seconds later.
- ADR 0041 bounds a transaction: `statement_timeout` 10 s and `idle_in_transaction_session_timeout` 15 s.

## Options considered

### Option A — Ask the server on every scan
- Pros: always current; nothing to sync.
- Cons: every scan pays a round trip, plus jitter, so NFR 5 depends on the shop's network. A slow second at the counter is felt by the customer.

### Option B — A copy in the browser's memory, synced by `updated_at` with an overlap
- Pros: a lookup takes well under a millisecond whatever the network does. One endpoint serves the full load and the changes (`GET /api/billing/catalogue[?since=]`). About 200 KB compressed for 5,000 items.
- Cons: the copy can be up to a minute old. The sync has to be designed carefully so no change is missed.

### Option C — A copy in IndexedDB, kept between visits
- Pros: no full load when the page opens.
- Cons: prices and item names stay on a shared counter computer after Chrome closes (`00` #40). Schema changes need migrations in the browser. The full load is small enough not to need it.

### Option D — Push changes to the browser (server-sent events or WebSockets)
- Pros: changes arrive in a second.
- Cons: a long-lived connection per counter, reconnect logic, and an event for every kind of change. Still needs a full load and a catch-up after a dropped connection, which is option B anyway.

## Decision

Option B. The billing page loads the catalogue once into memory, then asks every 60 s, when the tab comes back into view, and after a `prices_changed` answer for **changes since 60 s before the last `serverTime`**. A full reload every 30 minutes heals anything missed. The server never trusts the copy: at save (P1.14) it re-reads every item inside the bill's transaction, re-prices with the same shared functions (`cartToBillInput`, `calculateBill`, `discountWithinLimit`) and answers `409 prices_changed` when the shown prices or total differ.

## Why

- **Speed is independent of the network.** NFR 5 holds on a bad connection, and a lost connection keeps the bill on screen (ADR 0001).
- **The overlap makes the simple sync correct.** A sync from the exact last `serverTime` would miss a change stamped just before it and committed just after it. Asking from a minute earlier covers any transaction ADR 0041 lets live (at most 15 s idle, 10 s per statement), with room for the small difference between clocks. Rows seen twice are replaced by id, so the overlap costs only a few repeated rows. An API test holds a transaction open across a sync and proves the next sync returns its change and an exact-time sync would not.
- **A stale copy can't make a wrong bill.** The worst case is a "prices changed" prompt at save, never a bill at an old price.
- **Nothing private stays behind.** The copy lives in memory only, never has the purchase price, and sends stock only to callers with `stock.view`.

## Consequences

- Everything the copy shows must bump `items.updated_at` when it changes: item saves, archive and restore, barcodes added and removed, own units renamed or archived (P1.7). Stock uses `item_stock.updated_at` the same way. A future change that skips the bump would be missed until the 30-minute reload.
- `serverTime` comes from the API's clock, the same clock that stamps `updated_at`. If writes ever come from another clock (a second API server, a database trigger), the overlap must still cover the difference.
- The copy grows with the catalogue. At 5,000 items it's about 1.5 MB in memory and 200 KB on the wire; a business with far more items would need paging or IndexedDB (revisit then).
- P1.14 must answer `prices_changed` with the new prices, and the screen must re-sync and highlight the lines.

## Interview note

"The billing screen keeps the catalogue in the browser, so a scan never waits for the network, and it syncs every minute by `updated_at`. The subtle part is that a change is stamped when it's made but visible only when it commits, so each sync asks from a minute before the last one, longer than any transaction can stay open, and I have a test that holds a transaction open across a sync to prove it. The server re-prices every bill at save, so a stale copy can only cause a 'prices changed' prompt, never a wrong bill."
