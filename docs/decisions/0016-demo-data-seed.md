# 0016 — Demo data: a deterministic seed that runs through the app's own services

- **Date:** 2026-10-29
- **Status:** Accepted

## Context

Open question 6 in `product-overview.md`: a portfolio needs a realistic demo shop with months of sales, staff and udhaar, so the dashboard (Module 08) and the AI assistant (Module 09) have something to show. Recruiters need a way in without signing up.

## Options considered

### Option A — Hand-written SQL inserts
- Pros: full control.
- Cons: tedious; easily creates impossible states (stock that doesn't match its movements, bills without log rows); breaks with every schema change.

### Option B — Random data inserted straight into tables
- Pros: lots of data quickly.
- Cons: the same impossible-state problem; random means a different demo every run, so screenshots and AI evals drift.

### Option C — A seed script with a fixed random seed that calls the app's own services
- Pros: demo data obeys every business rule (stock, GST, entry log) because the real code creates it; the same seed gives the same data every run; it doubles as a large realistic test.
- Cons: slower to generate than raw inserts.

## Decision

Option C.

- `pnpm seed:demo` builds a demo shop through the domain services, starting with a kirana store and adding other business types later.
- Realistic patterns: weekday and festival peaks (a Diwali spike), regular and walk-in customers, udhaar customers with overdue balances, staff with leave, late days and advances, purchases from suppliers.
- Indian names, items with Hindi names, and Indian phone formats, with a fixed random seed.
- A one-click **demo login** on the deployed app, reset on a schedule.
- Built in steps: v1 at the end of Phase 1 (items, bills, udhaar), extended in Phase 2 (purchases, staff, salary) and Phase 3 (enough history for the AI eval set).

## Why

Demo data that goes through the real services can't contain states the app would never allow. A fixed seed keeps screenshots, end-to-end tests and the AI eval stable.

## Consequences

- Generating months of data through services may take a while, so it runs once per environment with batched transactions.
- The seed script must never run against production data. It refuses unless the target database is marked as a demo or local database.
- This moves the first demo data from Phase 3 to the end of Phase 1, so the dashboard can be built against realistic numbers.
- **Added 2026-11-24 (owner, sitting 3, decision D5).** The demo's rules and reset:
  - Two buttons, "Try as the owner" and "Try as a cashier", into one shared demo business, with a banner: public, resets, no real data, and the demo's passwords (the lock screen and the owner's-OK dialogs ask for one).
  - Refused in the demo, by a server-side flag checked in the services, each with a test: changing the password, email or recovery key; logging others out or forgetting computers; staff logins and permissions; sending email; GST status, business type, invoice label; archiving branches. Everything else works.
  - Demo customers have numbers that can't belong to real people (WhatsApp links open a real chat). The sheet's Excel and WhatsApp-sending limits drop out, as neither is in v1.
  - The assistant: $5 a month inside the app's $15 (`09` #19), 10 questions per visitor per hour.
  - A reset builds a new demo business; the buttons switch to it and old ones are hidden and archived, never deleted. At most weekly, when the worker starts, and by hand before an interview. This replaces "reset on a schedule".
  - Two Diwalis need more than a year of history, so older months get fewer bills; the size is measured at P1.20.

- **Built 2026-11-28 (P1.20), what the note turned into:**
  - A migration (`0022`): `businesses.demo`, and the list of demo shops in schema `auth` behind three `SECURITY DEFINER` functions on the guard's list. The one-click login comes before any business is known, and under row-level security that read can't be an ordinary query. A reset flags and lists the new shop as its last step, then archives the older ones. Nothing is deleted.
  - `pnpm seed:demo` runs the API inside the process with a clock it sets, and talks to it over HTTP: the same routes, rules, sessions and CSRF a browser meets. `--force` is "by hand before an interview"; the worker checks at start (`DEMO_ENABLED=true`).
  - The refusals are one function (`refuseInDemo`) in each service's own transaction, 16 of them, each with a test. A password can't be changed by any path, because `setPasswordIn` itself refuses.
  - Measured, as the note asked: 42 days, about 1,450 bills, 7.5 MB, about 90 s. Weekly resets cost about 400 MB a year, not 2 to 3 GB.
  - History ends **yesterday**, as the note says. The dashboard's "today" therefore starts empty until a visitor bills something; see the P1.20 report for the question this leaves.
  - Not built: the manual-reset GitHub workflow (needs a Terraform change and the owner's OK; the same command runs in a Session Manager shell), the assistant's demo cap (P3.5) and "more than a year of history for two Diwalis" (P3.1). Details: `docs/devops/demo-data.md`.

## Interview note

My demo shop is generated by a seed script that calls the same services the app uses, so the data obeys every business rule. Stock always matches its movements and every bill has its log entries. A fixed random seed makes it reproducible, so screenshots, end-to-end tests and my AI accuracy eval all run on the same data every time. It also acts as a big realistic test of the business logic.
