# 0001 — Online-first billing (no offline mode in v1)

- **Date:** 2026-10-29
- **Status:** Accepted

## Context

Open question 1 in `product-overview.md`: must billing keep working when the shop's internet drops? It is the biggest architecture choice, and it pulls against non-functional requirement 1 (zero data loss) and 3 (several counters billing at once). Offline billing means each counter keeps its own copy of the data and syncs later. Syncing is exactly where stock mismatches and lost records happen.

## Options considered

### Option A — Online only
- Pros: one source of truth; simplest.
- Cons: no billing during an outage; nothing prepared for adding offline later.

### Option B — Offline-first with sync
- Pros: billing never stops.
- Cons: every counter holds a local database; conflicting stock updates and invoice numbers must be merged; a whole project on its own and the most likely place for data loss. Too risky before the core works.

### Option C — Online first, built so offline can be added later
- Pros: the simplicity and correctness of A, without closing the door on B.
- Cons: still no billing during an outage in v1.

## Decision

Option C. v1 needs an internet connection. A dropped connection must never lose or duplicate a bill, and the data model must not block an offline mode later.

## Why

- Correct stock and invoice numbers across several counters are easy with one central database and very hard with sync.
- The core has to be right first. Offline is an add-on for later, once everything else is solid.
- During an outage a shop can fall back to a phone hotspot.

## Consequences

- Every record gets a UUID at the moment it is created, so records created offline later can't collide.
- Every "create" request from the screen carries an idempotency key, and a retried request returns the original result (ADR 0007).
- The billing screen shows a clear offline state and keeps the unsaved bill on screen until it is saved.
- If offline is added later, each counter gets its own invoice series. GST rules (CGST Rule 46) allow several series, as long as each is consecutive and unique per financial year.

## Interview note

The hardest part of a point-of-sale system isn't printing a bill, it's keeping stock and invoice numbers correct when several counters work at once, and offline sync makes that much harder. I chose online-first so there is one source of truth, but designed the data for offline later: UUIDs created at the source and idempotency keys so retries are safe. It's a conscious trade: less availability during outages in exchange for correctness, which is the top requirement.
