# 0045 — A session works in its computer's branch; the owner's branch picker only changes what read pages show

- **Date:** 2026-11-22
- **Status:** Accepted

## Context

P1.6 lets one business run several shops (branches). A person at a counter does two kinds of things:

- **Writes** that belong to a place: a bill, a stock change, a held bill, an entry-log row. These print or record a branch's address, GSTIN, stock and invoice number.
- **Reads** that the owner wants across places: how much of an item is in each shop, all shops added up, later the dashboard.

Today every session already carries one branch, the branch of the computer it was started on (`Caller.branchId`), and every write route uses it. The question is whether a person can act as a different branch from the one they are physically in (design `docs/plans/2026-11-22-p1.6-branches-design.md`, section 4; `00` #54).

GST adds a constraint: the place of supply follows where the goods are handed over, so a bill made at the Andheri counter must carry Andheri's address, GSTIN and invoice series whoever is logged in.

## Options considered

### Option A — The computer decides; the owner's picker is for looking (chosen)
- Pros: a bill is always a bill of the shop it was made in. Nobody can save something at the wrong branch by forgetting a picker. No change to `Caller.branchId` or to any write route.
- Cons: the owner who wants to enter something for another branch must go to a computer there, or wait for a form that genuinely needs a branch box (purchases, Module 04).

### Option B — The owner's picker switches the session's branch for everything
- Pros: one computer can run every shop.
- Cons: the owner could sell "as Thane" from the Andheri counter, printing Thane's address on a bill handed over in Andheri. That is wrong for GST and confuses stock. A session's branch would also change mid-session, so every cached screen and held bill would have to follow it.

### Option C — A branch box on every write form
- Pros: the most flexible.
- Cons: the most chances to save something at the wrong branch, and every write route and screen changes. A later module that truly needs it (purchases entered at the head office for another branch) can add a box on that one form.

## Decision

Option A.

- A **computer** belongs to one branch (`devices.branch_id`). The owner's first login on a new computer registers it: with one active branch nothing is asked; with two or more the login answers `409 { code: 'choose_branch', branches }` and is sent again with `branchId`. Moving a computer is `PUT /api/devices/:id/branch` with the owner's password; it ends the sessions open on it.
- A **session** takes its computer's branch and keeps it. Every write uses `Caller.branchId`.
- The owner's **picker** is only a query parameter on read routes: `?branch=<id>` for one branch, `?branch=all` where the page can add branches up. Staff get their session's branch whatever they send. The Stock reads (`GET /api/items`, `/api/items/:id/stock`, `/api/items/:id/stock/movements`) take it first; later read pages (dashboard, entry log) reuse `branchScope`.
- **Staff** work at their home branch and at the extra branches the owner ticked (`staff_branches`). That is checked at login (`403 wrong_branch`) and again on every request next to the permissions (ADR 0044's pattern), so unticking ends a logged-in cashier's session at their next click (`branch_removed`).
- **Invoice numbers** are per branch: the counter is per (branch, financial year), and once a business has a second branch the branch `code` is part of the number (`ABC/AND/2026-27/001`). Two counters in two shops then never wait on one lock, and every number is still unique. P1.14 builds the counter; P1.6 adds `branches.code` (1 to 6 capital letters or digits, unique per business).
- A **branch** is archived, never deleted (ADR 0007). The head office (the oldest branch) can't be archived; archiving is refused while active staff call the branch home; it forgets the branch's computers and ends their sessions. Its stock and history stay readable and it can be restored.

## Why

- **The record matches the place.** A bill, a stock change and an entry-log row are recorded where they physically happened, which is what a tax officer or a shop owner expects.
- **The wrong branch can't be saved by accident.** Writes have no branch input at all, so there is nothing to forget.
- **Cheap and safe to add.** The data model already carried the branch on every row and every session. Only reads gained a parameter, and the parameter's worst case (the owner looks at the wrong branch) changes nothing.
- **A permission change reaches an open session.** The branch check sits beside the permission check, which already runs on every request.

## Consequences

- Entering data for another branch means being at one of its computers (or, later, a form with its own branch box).
- A computer's branch is a security-relevant setting: moving one needs the owner's password and logs `device.moved`.
- Every read page that shows branch data must call `branchScope` and take `?branch=`; a page that forgets shows the computer's branch, which is safe.
- The migration backfills each existing branch's `code` (the oldest of a business is `HO`). It runs between `NO FORCE` and `FORCE ROW LEVEL SECURITY` because the migration role sees no rows under forced RLS (ADR 0027), and a test proves the row count.
- `staff_branches` is the one table the app may delete rows from (unticking a branch), because it is permission data, not a business record; every change is in the entry log. The tenancy guard names it in a short allowed list so any other DELETE grant still fails.

## Interview note

I made the computer, not the person, decide the branch for everything that gets written, and gave the owner a picker that only changes what read pages show. A bill printed in Andheri must carry Andheri's address, GSTIN and invoice number, and with no branch input on any write there is nothing to forget. I rejected a session-switching picker (the owner could print Thane's address on an Andheri bill) and a branch box on every form (more chances to pick wrong, and every route changes). Staff can work only at their home branch or branches the owner ticked, and that is read on every request, so unticking applies on the next click.
