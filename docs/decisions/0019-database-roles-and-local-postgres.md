# 0019 — Database roles, grants and local PostgreSQL

- **Date:** 2026-10-30
- **Status:** Accepted

## Context

ADRs 0006 and 0007 say the app connects as a runtime role that owns no tables, has no `BYPASSRLS` and has no `DELETE`, while migrations run as a separate owner role. ADR 0005 says the same PostgreSQL major version runs everywhere, and ADR 0013 says integration tests use a real PostgreSQL through Testcontainers. P0.3 had to make that concrete:

- how the roles get created;
- how every future table gets the right grants;
- which driver and Drizzle version to use;
- which Docker image to run;
- where the integration tests run.

## Options considered

### Creating the roles and the database

#### Option A — A bootstrap SQL file run by an administrator (chosen)
- Pros: creating roles and databases is server-wide work that needs an administrator, so it stays out of the migration role's power. Passwords come from environment variables, never from git. The same file runs in Docker (on an empty volume), in Testcontainers and, once by hand, on RDS.
- Cons: it is not tracked like a migration, so changes after first run must be applied by hand.

#### Option B — Create the roles in a Drizzle migration
- Cons: the migration role would need `CREATEROLE` (more power than it should have), and role passwords would end up in a migration file in git.

#### Option C — Terraform's PostgreSQL provider
- Cons: it doesn't help locally or in Testcontainers, and it isn't needed before DevOps stage 5. Can be revisited then.

### Granting the runtime role access to tables

#### Option A — `ALTER DEFAULT PRIVILEGES` in the first migration (chosen)
- Pros: every table the owner creates from then on automatically gets `SELECT, INSERT, UPDATE` for the runtime role, and never `DELETE` or `TRUNCATE`. Nobody has to remember a `GRANT` per table. It's a migration, so it is reviewed and runs in every environment.
- Cons: a table that needs fewer rights (the append-only entry log, P1.2) must `REVOKE UPDATE` explicitly.

#### Option B — A `GRANT` in each table's migration
- Cons: one forgotten line means a broken feature, and one extra word (`DELETE`) means a broken safety rule.

### Database driver

- **`pg` / node-postgres (chosen):** the most widely used Node driver, and pg-boss (ADR 0010) already uses it, so the app has one driver.
- **`postgres` (postgres.js):** fast and modern, but it would be a second driver next to pg-boss's.

### Drizzle version

- **0.45, the latest stable (chosen).**
- **1.0 release candidate:** rejected for now. Don't build on a release candidate. 1.0 changes the migrations folder layout, and `drizzle-kit up` converts it when we upgrade.

### Docker image

- **`postgres:18`, Debian-based (chosen):** the closer match to RDS. It uses glibc like a standard Linux server, and PostgreSQL 18 is the newest major version RDS supports.
- **`postgres:18-alpine`:** smaller, but it uses musl, whose locale support and text sorting differ from glibc's. Rejected so that local behaviour stays as close to RDS as possible.
- Neither image *guarantees* the same sort order as RDS: glibc's sorting rules change between versions, and RDS ships its own build. When sorting starts to matter (Hindi item names, P1.7), use an ICU collation, which is versioned and identical everywhere, and verify it on RDS.

### Where integration tests run

- **Inside `pnpm test` (chosen):** one command checks everything. The cost is that Docker Desktop must be running for `pnpm test` and `pnpm check`.
- **A separate `pnpm test:integration`:** faster unit runs, but easy to forget to run.

## Decision

1. Bootstrap file `packages/db/bootstrap/create-roles.sql` creates `app_owner` and `app_runtime` and the database `business_software`, owned by `app_owner`. Neither role has superuser, `BYPASSRLS`, `CREATEROLE` or `CREATEDB`.
2. Migration `0000_runtime_grants.sql` sets default privileges: `SELECT, INSERT, UPDATE` on tables and `USAGE, SELECT` on sequences for `app_runtime`.
3. Driver: `pg`. ORM: drizzle-orm 0.45 + drizzle-kit 0.31.
4. Local database: `postgres:18` in `compose.yaml`, bound to `127.0.0.1`, with the volume mounted at `/var/lib/postgresql` (the PostgreSQL 18 layout). The integration test reads its image from `compose.yaml`.
5. Integration tests run inside `pnpm test`.

## Why

The safety rules from ADRs 0006 and 0007 only hold if the roles are set up exactly right in every environment. One bootstrap file plus one grants migration makes that repeatable, and an integration test proves it on every run. Default privileges turn "never grant DELETE" from something to remember into the default.

## Consequences

- Docker runs the bootstrap only on an empty volume. Changing a password in `.env` later changes nothing until the role is altered by hand (`docs/devops/local-database.md`).
- On RDS the master user isn't a true superuser. At stage 5 the bootstrap may need `GRANT app_owner TO <master>` before `CREATE DATABASE … OWNER app_owner`.
- P1.2's entry-log table must `REVOKE UPDATE` from `app_runtime`.
- Migrations run locally with `drizzle-kit migrate`. P0.4 decides how production runs them.
- Upgrade Drizzle to 1.0 once it is stable, with `drizzle-kit up`.
- Item-name sorting (P1.7) needs an ICU collation decision. The image choice alone doesn't make sorting identical to RDS.

## Interview note

The app logs in as a database role that can't delete rows or change the schema; a separate owner role runs migrations. Roles come from a one-time bootstrap script, because creating roles needs admin rights and passwords mustn't be in git. Grants come from default privileges in the first migration, so every future table is safe automatically, and an integration test on a throwaway PostgreSQL proves that delete, truncate, create and drop are all refused.
