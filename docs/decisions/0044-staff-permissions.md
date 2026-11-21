# 0044 — Staff permissions are stored as changes from the defaults and read on every request

- **Date:** 2026-11-22
- **Status:** Accepted

## Context

P1.5 lets the owner give each staff login its own set of switches (`00` #15–#17, #47–#53; design `docs/plans/2026-11-21-p1.5-staff-design.md` §3–§5). Two things are true of the product:

- Every later module adds permissions (`billing.cancel`, `udhaar.give`, `udhaar.record_payment`, salary switches...). Some are on for staff by default (`udhaar.record_payment`, `03` #11), some off.
- A change must reach a staff member who is already logged in, on their next request, without a new login (owner's answer 6A). Deactivation and password reset still end sessions at once.

The migration role sees no `users` rows under forced row-level security (ADR 0027's trap), so a migration can't fill a new permission into existing logins.

## Options considered

### Option A — Store each person's full permission list
- Pros: the row says exactly what the person can do.
- Cons: a permission added later is missing from every login made before it, whatever its default, and a migration can't backfill it. Every module would need a script that runs as each business.

### Option B — Copy the permissions into the session row, or cache them per session
- Pros: no extra columns read per request.
- Cons: a change must find and update (or invalidate) every open session of that person on every counter, or it waits for the next login. A missed update leaves a removed permission working. The saving is nothing: the request already reads the `users` row for the deactivation check.

### Option C — A database check on the permission names
- Pros: a typo can't be stored.
- Cons: the list grows with every module, so each module would need a migration just to extend the check (as the 1.5% GST rate did). The check also can't protect the real rule, which is what the code grants when it reads the list.

### Option D — Store only the changes from the defaults, and read them on every request (chosen)
- Pros: a new permission takes its default for every login that never had a choice about it; a sensitive one is simply off. Nothing to invalidate. Bad stored data can't grant anything.
- Cons: the effective list has to be computed (a small pure function); the row alone doesn't show what the person can do.

## Decision

`users` gets `permissions_added` and `permissions_removed` (text arrays, with a check that they don't overlap), `home_branch_id` and `discount_limit_basis_points`. The effective permissions are `((defaults ∪ added) − removed) ∩ switchable`, minus any switch whose parent is off, plus `session.own`, computed by `effectivePermissions` in `packages/shared`. `applyRules` (every request) and `startIn` (login) read the two lists with the row they already read, and build `caller.permissions` from them. The session view reports the same list and the effective discount limit. Names are checked by Zod and by the save route (`422 invalid_permissions`), never by the database; a stored name the code doesn't know, or an owner-only one, is ignored when read.

## Why

- **A later module can't leave anyone behind.** The defaults live in code (`STAFF_SWITCHES`), so adding a switch is one code change, with no migration and no per-business script.
- **A change is instant and complete.** The next request of every session of that person uses the new set. A permission change doesn't end sessions (the person is still trusted); only deactivation and a password reset do.
- **It fails safe.** An unknown or owner-only stored name, or a child whose parent is off, grants nothing.
- **Cheap.** Two more columns on a row the request already selects: no extra query, no cache to keep right.

## Consequences

- A module that adds a switch adds its permission to `PERMISSIONS` and to `STAFF_SWITCHES` (with its default and parent) in the same PR. A switch removed from the code later simply stops mattering.
- Changing a default changes what existing logins that never chose it can do. That is the point (a default applies to people who haven't been given a choice), but a change to a default is a product decision to log, not a refactor.
- The owner's row keeps the lists empty (a check); the owner holds every permission by role.
- The web app learns the list from `GET /api/session` and must refetch on focus and after a `403 forbidden`; the server is the lock, hiding screens is only help.
- The stored discount limit survives the switch being turned off and on again; the session view shows 0 while it is off.

## Interview note

I store only what the owner changed from the defaults and compute the effective permissions on every request from the row the request already reads. That way a permission added by a later module takes its default for existing staff without a migration, and a change reaches an open session on its next click with nothing to invalidate. I rejected storing the full list (it goes stale as modules add permissions), copying permissions into the session (it needs invalidating), and a database check on the names (it needs a migration per module).
