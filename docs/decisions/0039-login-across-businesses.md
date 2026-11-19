# 0039 — Login by email across businesses: an `auth` schema the app can't touch, two pinned definer functions

- **Date:** 2026-11-19
- **Status:** Accepted (owner's OK 2026-11-19)

## Context

The owner logs in with an email and a password (Module 00 #27). At that moment no business is known, but every tenant table is under `FORCE` row-level security (ADRs 0006, 0027): without `app.business_id`, `app_runtime` sees no `users` row, and so does the table owner `app_owner`. Something has to map an email to its business without opening a hole in tenancy. One email belongs to one owner account across the whole app (Module 00 #27). Staff logins don't have this problem: the device cookie carries the business ID (ADR 0038).

## Options considered

### Option A — a separate `auth` schema the app has no USAGE on, read and written only through two `SECURITY DEFINER` functions (chosen)
- Pros: the app can ask exactly one question ("which business and user own this email?") and can't list, change or delete mappings; the function never returns a password hash, so the hash is still read under RLS in the business's own transaction; the tenancy guard can check the whole arrangement.
- Cons: definer functions run with their owner's rights, so each one must pin `search_path` and be on an allowed list; the mapping is a second copy of the email that must be written in the same transaction as the owner.

### Option B — a policy on `users` that lets anyone read rows by email
- Cons: a policy that matches without a business is exactly the bypass RLS exists to prevent; one wrong `where` and any query sees every business's users.

### Option C — a `BYPASSRLS` role just for login
- Cons: a whole second database login whose every query skips tenancy; one bug there reads everything.

### Option D — put the business in the login (a shop code, or a subdomain per business)
- Pros: no cross-business lookup at all.
- Cons: shopkeepers would have to remember a code; subdomains need wildcard DNS and certificates on a free DuckDNS name. Module 00 #27 says email and password.

## Decision

Option A.

- Schema `auth`, table `auth.owner_logins (email primary key, business_id unique, user_id)` with a foreign key to the owner's row. No RLS (it isn't tenant data). `app_runtime` has no USAGE on `auth`; `auth` is on the guard's `NOT_TENANT_SCHEMAS` list.
- `app_find_owner_login(email)` returns at most one `(business_id, user_id)` pair, never a hash. Login then reads and verifies the owner inside `withBusiness(business_id)`.
- `app_register_owner_login(user_id)` runs inside the signup transaction. It reads the owner through the transaction's own business (RLS still applies to the caller's session settings), copies that row's email and raises `P0002` if no owner matches, so it can't map an email to another business. A second registration for the same email or business fails on the unique keys (`23505`).
- Both functions are owned by `app_owner`, `SET search_path = pg_catalog, pg_temp`, `REVOKE EXECUTE … FROM PUBLIC`, `GRANT EXECUTE … TO app_runtime`, and listed in the guard's `DEFINER_ALLOWED`. A new guard rule, `definer_search_path`, fails any allowed definer function without a pinned `search_path`; it is probed with one that has none.
- No backfill: the migration runs as `app_owner`, which can't read `users` under `FORCE`. The live server has no businesses yet; on a laptop, an owner who signed up before this migration signs up again (`docs/devops/local-database.md`).

## Why

It keeps the one cross-business read as narrow as a single question with a single answer, and every other step of login stays inside RLS. The database, not the API code, enforces that the app can't do more, and the guard test proves it on every run.

## Consequences

- **Added 2026-11-19 (review of PR #33): one transaction may step into a second business.** Logging in to business B in a browser whose cookie holds a session of business A must end A's session in the same transaction that starts B's. `alsoInBusiness(tx, businessId, work)` in `packages/db/src/tenancy.ts` sets `app.business_id` to A for `work`, then back to B, even if `work` fails; RLS applies to each step as usual, and both commit or roll back together. It is for an action that spans two businesses by nature; tests prove it switches back and rolls back both.

- Changing an owner's email (out of v1, design answer 11) will need a third function that updates the mapping in the same transaction.
- PR 2's password reset by email and by recovery key finds the business through `app_find_owner_login` too.
- Any future definer function has to be added to `DEFINER_ALLOWED` with a reason and pin its `search_path`, or CI fails.

## Interview note

Login by email is the one moment the app doesn't yet know which business it's serving, and with forced row-level security even the table owner can't search users across businesses. I put the email-to-business mapping in a schema the app role can't touch and exposed it only through a SECURITY DEFINER function that answers one question and never returns a password hash; the hash is then checked inside that business's own RLS transaction. A schema test checks that every definer function is on an allowed list and pins its search_path, the classic way such functions get hijacked.
