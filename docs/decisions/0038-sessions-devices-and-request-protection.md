# 0038 — Sessions, remembered computers and request protection: cookie formats, CSRF, lock, rate limits

- **Date:** 2026-11-19
- **Status:** Accepted

## Context

ADR 0009 chose server-side sessions in PostgreSQL with a token in an `HttpOnly` cookie, Argon2id passwords, rate-limited logins and auto-lock, and left the details to the first auth task. P1.4 is that task (design: `docs/plans/2026-11-19-p1.4-login-design.md`, approved with all 11 answers on 2026-11-19). The requirements it has to meet: the owner logs in by email (Module 00 #27); staff log in by username, but only on a counter the owner has used (#28, #44); the owner's session locks after `owner_lock_minutes` idle and unlocks with the password (#21, #38); a staff session ends after `staff_idle_minutes` (#29); closing Chrome logs out (#40); signup logs the owner in (#37); failed logins wait 15 minutes after 10 wrong passwords (#41). The app runs on one small server behind Caddy (ADR 0032), with no Redis.

## Options considered

### Where the session token lives

#### Option A — an `HttpOnly` cookie holding `<businessId>.<token>` (chosen)
- Pros: JavaScript can never read it (an XSS bug can't steal it); the business ID next to the token lets every lookup run as an ordinary `withBusiness` read under RLS, so no lookup needs to cross businesses.
- Cons: cookies ride along on cross-site requests, so CSRF needs its own defence.

#### Option B — a token in `localStorage`, sent as `Authorization: Bearer`
- Pros: no CSRF.
- Cons: any XSS bug can read it and send it anywhere; ADR 0009 already ruled it out.

### CSRF defence

#### Option A — `Sec-Fetch-Site` / `Origin` check on every unsafe request, plus a per-session token in `X-CSRF-Token` (chosen)
- Pros: two independent layers; the token is derived from the session token (`sha256('csrf:' + token)`), so `GET /api/session` can hand it out again after a reload without storing a second secret in the browser; the origin check also covers public routes (login CSRF).
- Cons: the web app must keep the token in memory and send it on every write.

#### Option B — `SameSite=Strict` alone
- Cons: one layer only; Strict also drops the cookie when the owner follows a link to the app from an email or WhatsApp, which looks like being logged out.

### Rate limits and the Argon2 queue

#### Option A — in memory, fixed 15-minute windows, behind `trust proxy` 1 (chosen)
- Pros: no new service; one API process on one server (ADRs 0004, 0032); `trust proxy` 1 trusts only Caddy's `X-Forwarded-For` hop, so a forged header can't buy a fresh IP.
- Cons: counters reset when the API restarts, and won't work across two API processes. Fine on one server; a second process would need them in PostgreSQL.

#### Option B — a PostgreSQL table
- Cons: a write on every attempt, and a table `app_runtime` can write without a business, which the tenancy guard would have to allow.

## Decision

- **Cookies.** `__Host-session` = `<businessId>.<token>`, `HttpOnly; Secure; SameSite=Lax; Path=/`, no `Max-Age`, so it ends when Chrome closes (#40). `__Host-device` = `<businessId>.<token>`, same flags, `Max-Age` 400 days (Chrome's cap), set or refreshed at each owner login: the "remembered computer" that lets staff log in (#28, #44). Tokens are 32 random bytes (base64url), stored only as SHA-256 hashes. A malformed cookie is "no session", never a 500. `COOKIE_SECURE=false` drops the `__Host-` prefix and `Secure`, for a browser that refuses them over plain HTTP (Chrome doesn't, on `127.0.0.1`).
- **Tables.** `sessions` (user, branch, device, token and CSRF hashes, `last_active_at`, `locked_at`, `ended_at` with a reason: `logout`, `idle`, `replaced`, `password_changed`, `deactivated`, `reset`) and `devices` (branch, token hash, `last_seen_at`, `revoked_at`). Both are tenant tables under `FORCE` RLS and are never deleted (session rows are evidence of who was logged in, ADR 0009).
- **Routes.** `POST /api/login`, `POST /api/login/staff` (public); `GET /api/session` (public and passive: the session view with the CSRF token, or, with no session, the business this computer remembers); `POST /api/session/lock` (owner), `POST /api/session/unlock`, `POST /api/logout` (both work on a locked session); `POST /api/session/active` ("someone is still here"). Signup starts a session in its own transaction (#37).
- **Lock and idle.** The guard resolves every non-public request: past `owner_lock_minutes` idle the owner's session is marked locked and answers `401 locked`; past `staff_idle_minutes` a staff session ends (`401 session_ended`); a deactivated login's sessions end. Strictly greater than the limit, measured from `last_active_at`, which any non-`@Passive` request refreshes (written at most every 15 seconds). The web app runs the same timer from key presses, clicks, scrolls and touches, covers the screen at the same moment, and sends `POST /api/session/active` at most every 30 seconds while someone is typing, so a long bill with no other request doesn't lock early.
- **One session per browser.** Logging in while the cookie holds another live session ends it (`replaced`): that is "Switch user" on a shared counter (#18).
- **Wrong logins.** Unknown email, unknown username, wrong password and a deactivated login all answer `401 wrong_login`, after a real or dummy Argon2id verify so the timing matches. Old hash parameters are rehashed at login (ADR 0035).
- **Rate limits (in memory).** 30 attempts per IP per 15 minutes; 10 wrong passwords per login per 15 minutes (#41; the right password is refused too until the window ends); 5 signups per IP per hour; 10 wrong unlocks per session per 15 minutes. A refusal is `429 too_many_attempts` with `retryAt`. At most 2 Argon2id hashes run at once and 20 wait; beyond that `503 busy`.
- **Request rules.** `trust proxy` 1. Every answer carries `Cache-Control: no-store`. Any unsafe request whose `Sec-Fetch-Site` isn't `same-origin` or `none` (or, without that header, whose `Origin` host doesn't match) answers `403 cross_site`; an unsafe request from a session without the right `X-CSRF-Token` answers `403 csrf`.
- **Entry log (06 L2).** `user.logged_in`, `user.logged_out`, `session.locked`, `session.unlocked`, `device.registered`. Failed logins aren't logged; the rate limit counts them.

## Why

Every piece follows from the shared counter. Instant revocation and lock need server state (ADR 0009); the business ID in the cookie keeps every lookup inside RLS; two CSRF layers cost little; in-memory limits are enough for one API process and add no service to a ₹0 budget. Counting typing as activity matches what "idle" means to a shopkeeper, while the server still enforces the rule on its own clock.

## Consequences

- The web app keeps the CSRF token in memory and re-reads `GET /api/session` after a reload or any `401`.
- Rate-limit counters reset on restart and are per process; a second API process would need them in PostgreSQL.
- A device cookie is the only way a staff login works; revoking a device (PR 2, Settings) stops staff logins there.
- Login by email still has to find the business before RLS can apply: ADR 0039.
- Checked in the real app (2026-11-19): Chrome accepts `Secure` and `__Host-` cookies on `http://127.0.0.1`, which it treats as a secure context, so `pnpm dev` and `pnpm app:up` use the same cookie names as production. `COOKIE_SECURE=false` stays only for a browser that refuses them over plain HTTP.

## Interview note

The login keeps a random token in an HttpOnly cookie and only its SHA-256 hash in PostgreSQL, with the business ID next to the token so every session lookup still runs under row-level security. CSRF has two layers, a same-origin check on every write and a per-session token in a header, and failed logins are rate-limited in memory per IP and per login, with Argon2 hashing behind a small queue so a burst can't exhaust the server. The owner's screen locks after idle minutes both in the browser and on the server, and the server's rule is the one that counts.
