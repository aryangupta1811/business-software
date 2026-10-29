# 0009 — Login: server-side sessions with Argon2id passwords

- **Date:** 2026-10-29
- **Status:** Accepted

## Context

Owner and staff share one counter computer, and each staff member with access logs in with their own ID (Module 00 #18). The owner's session locks itself after inactivity (#21). Changing permissions needs the owner's password (#17). A staff member who leaves is deactivated, never deleted (open question in Module 00). Security NFR 6: passwords, auto-lock, owner password for permission changes.

## Options considered

### Option A — JWT access + refresh tokens
- Pros: stateless; common in tutorials.
- Cons: a token stays valid until it expires, so "lock now" or "this staff member just left" needs a denylist, which brings back server state. Easy to store insecurely in the browser.

### Option B — Server-side sessions in PostgreSQL, with a random token in an httpOnly cookie
- Pros: instant revocation (deactivate, lock, permission change); the browser never holds anything meaningful; simple to reason about.
- Cons: one session lookup per request (cheap with an index); cookies need CSRF protection.

### Option C — A hosted auth service (Auth0, Clerk, Cognito)
- Pros: less code; extra features like social login.
- Cons: cost at scale and vendor lock-in; owner-created staff usernames without email don't fit well; we'd learn less.

## Decision

Option B.

- A session row in PostgreSQL holds the user, business, branch, created and last-active times, and a locked flag.
- The browser gets a random session token in a cookie set `httpOnly`, `Secure`, `SameSite=Lax`. Unsafe requests also carry a CSRF token.
- Passwords are hashed with **Argon2id**.
- Login attempts are rate-limited per username and per IP address.
- **Auto-lock:** after the idle time, the session is marked locked, and the next request needs the password again. The exact time is still an open question in Module 00.
- **Re-authentication:** sensitive actions (permission changes) ask for the owner's password again, even inside an unlocked session.
- Library vs a thin layer of our own on vetted primitives: decided in the first auth task.

## Why

Instant revocation is a hard requirement on a shared computer, and server sessions give it with the least complexity. Argon2id is the current OWASP recommendation for password hashing.

## Consequences

- Deactivating a user deletes nothing: their sessions are revoked and their login is disabled (ADR 0007).
- How the owner resets a forgotten password (email OTP or SMS OTP) is still open in Module 00 and must be answered before the auth task.
- Session rows are business data for the entry log ("who was logged in") and are kept, not deleted.

## Interview note

The app runs on a shared shop computer, so access has to stop the instant the owner's screen locks or a staff member leaves, which is hard with JWTs because they stay valid until they expire. I used server-side sessions in PostgreSQL with only a random token in an httpOnly cookie, Argon2id for passwords, rate-limited logins, and re-authentication for permission changes. The trade-off is one indexed lookup per request, which is negligible.
