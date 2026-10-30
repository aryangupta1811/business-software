# 0021 — Production migrations: a one-shot migrate container, run before the app starts

- **Date:** 2026-10-30
- **Status:** Accepted

## Context

ADR 0019 left open how migrations run outside the laptop (locally: `pnpm db:migrate` with drizzle-kit). Migrations must run as `app_owner`, the only role allowed to change the schema. The app runs as `app_runtime` (ADRs 0006, 0007). Production is Docker Compose on one EC2 server (ADR 0011), deployed through Systems Manager (stage 6). Zero data loss is the top requirement (`product-overview.md` NFR 1), and destructive migrations need the owner's OK (`CLAUDE.md` rule 7).

Found while deciding: Drizzle 0.x applies migrations by timestamp and **silently skips** any migration older than the newest one already applied. If two branches each add a migration and the older one merges second, it never runs.

## Options considered

### Option A — A one-shot `migrate` container (chosen)
- Pros:
  - Same image as the app, different command (`node dist/migrate.js`), logged in as `app_owner`.
  - Compose starts `api` and `worker` only after it exits successfully (`service_completed_successfully`). So new code never runs against an old schema, and a failed migration stops the rollout before anything changes.
  - Identical locally (`pnpm app:up`) and on EC2.
- Cons: an extra service in `compose.yaml`; its credentials (`app_owner`) must be available on the server at deploy time.

### Option B — The API migrates itself at startup
- Pros: nothing extra to run.
- Cons:
  - The long-running app would need `app_owner`'s rights, which breaks ADR 0007's whole point.
  - Two processes starting at once would race (`api` and `worker`).

### Option C — CI runs migrations against RDS from GitHub Actions
- Pros: migrations visible in the pipeline log.
- Cons: RDS isn't reachable from the internet (and shouldn't be), so CI would need network access into the VPC. The schema could also change before the new image is running.

### Option D — Run `drizzle-kit migrate` by hand on the server
- Cons: manual, easy to forget, and needs dev tools on the server.

## Decision

1. `apps/api/src/migrate.ts` → `runMigrations(MIGRATION_DATABASE_URL)` from `packages/db` (Drizzle's code migrator with the committed `migrations/` folder, shipped in the image).
2. Compose service `migrate` runs it once as `app_owner`. `api` and `worker` depend on it with `condition: service_completed_successfully`.
3. Errors print only messages (`describeError`, ADR 0020): the name of a missing variable, or PostgreSQL's reason, such as `password authentication failed for user "app_owner"`. Never the URL or an error object (ADR 0020 explains why). A failed run exits 1, so `api` and `worker` are never started (checked: they stay `Created`).
4. Locally, `pnpm db:migrate` (drizzle-kit) stays for development. Both use Drizzle's journal table (`drizzle.__drizzle_migrations`), so they agree on what has run.
5. **Rule for migration PRs:** before merging, rebase on `main`. If `main` gained a newer migration meanwhile, delete yours and run `pnpm db:generate` again, so its timestamp is newest (`docs/devops/git-workflow.md`).

## Why

Only a separate, short-lived process can hold the owner role without giving it to the long-running app, and running it first makes "schema before code" automatic. It reuses the image we already build, so there's nothing new to deploy.

## Consequences

- At stage 6 the deploy passes `MIGRATION_DATABASE_URL` (from SSM) only to the `migrate` service, and `DATABASE_URL` only to `api` and `worker`.
- Migrations must stay backwards-compatible with the running version (add columns, don't rename or drop in one step), because the old containers keep serving until the new ones start. Destructive changes still need the owner's OK and a fresh backup.
- The skipped-migration trap stays a rule until a CI check enforces it (P0.6 can compare migration timestamps with `main`) or Drizzle 1.0 changes the behaviour.

## Interview note

Migrations run in a one-shot container from the same image, as the schema-owner role, and the app containers only start after it exits successfully. So new code never meets an old schema, and the long-running app never holds the rights to change the schema. I also found that Drizzle silently skips a migration older than the newest applied one, so migration PRs must be rebased and regenerated before merging.
