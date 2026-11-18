# 0035 — Password hashing: Node's built-in Argon2id, stored as PHC strings

- **Date:** 2026-11-18
- **Status:** Accepted

## Context

ADR 0009 chose Argon2id for passwords and left "a library or a thin layer of our own on vetted primitives" to the first auth task. That task is P1.3: signup now sets the owner's first password (Module 00 #7, changed 2026-11-18), before login exists (P1.4). The 2026-11-10 plan review found Argon2id built into Node 24 (`crypto.argon2`): about 30 ms at 19 MiB and 2 passes, also inside the ARM64 image. Stored hashes must survive raising the cost later, and the zero-data-loss rule means old rows are never rewritten in bulk.

## Options considered

### Option A — Node's built-in `crypto.argon2` with a small wrapper (chosen)
- Pros: no dependency, no native build, no install script (the repo denies install scripts, `pnpm-workspace.yaml`), nothing for `minimumReleaseAge` to vet; OpenSSL's implementation; the same code on the laptop, in CI and on the ARM64 server.
- Cons: Node returns raw bytes, so we write the encoding (PHC string), the parsing and the constant-time compare ourselves, about 60 lines, and must prove them with a published test vector.

### Option B — the `argon2` npm package
- Pros: produces and verifies PHC strings itself; widely used.
- Cons: a native addon with prebuilt binaries per platform, or a build at install time; an install script; one more supply-chain dependency for something Node already has.

### Option C — bcrypt or scrypt
- Cons: bcrypt cuts passwords at 72 bytes (a Hindi passphrase reaches that quickly in UTF-8) and isn't memory-hard; scrypt is fine but OWASP lists Argon2id first, and ADR 0009 already chose it.

## Decision

Option A. `apps/api/src/auth/password.ts`:

- `hashPassword` uses Argon2id with OWASP's minimum parameters (memory 19 MiB, 2 passes, 1 lane), a 16-byte random salt and a 32-byte tag, and returns a **PHC string**: `$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>` (base64 without padding).
- `verifyPassword` reads the parameters from the stored string, recomputes and compares with `timingSafeEqual`. Anything it can't read, or parameters outside sane limits (memory ≤ 256 MiB, passes ≤ 10, lanes ≤ 8), is a refusal, never an exception.
- Passwords are used exactly as typed: never trimmed or case-folded.
- A test checks Node's function against RFC 9106's Argon2id test vector.

## Why

Node ships a vetted Argon2id, so a dependency would add risk and build complexity for nothing. Storing the parameters with each hash lets P1.4 raise them later and rehash a user's password at their next login, without touching other rows.

## Consequences

- P1.4 can add "rehash at login when the stored parameters are older" without a migration.
- Each hash takes about 19 MiB for about 30 ms: ten at once is about 190 MiB on the 2 GB server. P1.4's login and signup rate limits cap this.
- The password is hashed before the signup transaction opens, so a slow hash never holds a database connection.
- Recovery keys are not passwords: 160 random bits can't be guessed, so they're stored as SHA-256 (design `docs/plans/2026-11-18-p1.3-signup-design.md`, section 4).

## Interview note

I hash passwords with Argon2id from Node's own crypto module, so there's no native package or install script in the supply chain, and I proved my wrapper against the RFC's published test vector. Each hash is stored as a PHC string that carries its own memory and pass settings, so I can raise the cost later and rehash users at their next login. Verification compares in constant time and treats any unreadable stored value as a wrong password rather than an error.
