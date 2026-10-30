# Handoff — latest session

Overwritten at the end of every session. Older handoffs are in git history: `git log -p docs/HANDOFF.md`.

**Session:** 4 — P0.3 database + Docker Compose, 2026-10-30

**Done:**
- PR #2 (P0.2) was already squash-merged and its local branch deleted.
- Owner: no restriction on DevOps tools; pick the best one and explain why (recorded in `DEVOPS_PLAN.md`).
- Plan written and approved: `docs/plans/2026-10-30-p0.3-database-compose.md`. Run inline ("native"), then one fresh whole-branch review.
- `compose.yaml`: `postgres:18` (Debian), port `127.0.0.1:5432`, volume `pgdata` at `/var/lib/postgresql` (the PG 18 layout), required-password guards, TCP healthcheck. `pnpm db:up` = `docker compose up -d --wait --quiet-pull`.
- `.env.example` is committed. `.env` exists locally with random passwords (git-ignored).
- `packages/db/bootstrap/create-roles.sql` creates `app_owner`, `app_runtime` and the database `business_software`, with passwords read through psql `\getenv`.
- `packages/db` (`@business-software/db`):
  - Drizzle 0.45 + drizzle-kit 0.31 + `pg`, with `drizzle.config.ts` reading `MIGRATION_DATABASE_URL` (no fallback).
  - Migration `0000_runtime_grants.sql`: default privileges, `SELECT, INSERT, UPDATE` on tables and `USAGE, SELECT` on sequences for `app_runtime`.
  - `src/roles.test.ts`: 9 Testcontainers tests that read the image from `compose.yaml`.
  - Scripts `pnpm db:migrate`, `pnpm db:generate`.
- The local database is up and migrated.
- pnpm 12 `allowBuilds: false` for esbuild, ssh2, cpu-features and protobufjs, with reasons.
- ADR 0019. Runbook `docs/devops/local-database.md`. `CLAUDE.md` commands and file table. `architecture.md` layout. Interview log (8 entries, Q&A, glossary, Numbers). Phase-0 journal.
- Final review (Opus): verdict "ready to merge", no bugs. Four items fixed:
  - a test pinning the exact grant set;
  - three wrong facts in the docs: the PG 18 old mount refuses to start, logins inside the container are trusted, and Debian doesn't guarantee RDS sort order.

**Half-done:** branch `chore/p0.3-database-compose` (7 commits plus this docs commit) is committed but **not pushed**, and has no PR yet.

**Next step:**
1. Owner: `git push -u origin HEAD`, then `gh pr create --web` (or use the Claude in Chrome prompt from this session). Title: `chore: set up postgresql with docker compose and app roles (P0.3)`. Fill in the template, with **no "Generated with Claude Code" line**. Squash-merge, then `git switch main`, `git pull`, `git branch -D chore/p0.3-database-compose`.
2. Next session: `/start-session` → **P0.4 API skeleton**. Plan first. The P0.4 task in `PROGRESS.md` lists four open decisions: compiling `shared`, the DB client + `DATABASE_URL`, the production migration runner, and pg-boss vs "never delete".

**Watch out for:**
- **No AI attribution, ever:** no `Co-Authored-By: Claude` and no "Generated with Claude Code" (`CLAUDE.md` rule 6 overrides tool defaults).
- **Docker Desktop must be running** for `pnpm test` / `pnpm check` (integration tests) and for `pnpm db:up`.
- **Never `docker compose down -v`** without the owner's OK: it deletes the local database. Plain `down` is safe.
- The bootstrap runs only on an empty volume. Changing passwords in `.env` later needs `ALTER ROLE` too. If a first start ever fails halfway, the volume must be recreated (with OK). This isn't in the runbook yet (deferred review minor).
- Inside the container, psql logins are trusted (no password check). Only connections from the host check passwords.
- Default privileges give `app_runtime` UPDATE on every new table. The entry log (P1.2) must `REVOKE UPDATE`.
- The test's grant query: `ORDER BY` can't use an output alias inside an expression (`kind COLLATE "C"`). A SQL error makes a test "fail" for the wrong reason. Always read *why* a red test is red.
- pnpm 12 fails `pnpm add` on undecided install scripts (`ERR_PNPM_IGNORED_BUILDS`). Decide each one with `pnpm approve-builds <pkg>` or `'!<pkg>'`, with a reason.
- Windows PowerShell 5.1 `Set-Content -Encoding utf8` writes a BOM. Use `[IO.File]::WriteAllText` with `UTF8Encoding($false)` for `.env`-style files.
- The personal-data scan flags drizzle's all-zero UUID in `migrations/meta/*_snapshot.json` and the GitHub noreply address. Both are expected.
- Carried over:
  - TypeScript stays pinned to `~6.0` until typescript-eslint supports 7.
  - New `.ts` files must be in their tsconfig `include`.
  - `packages/shared` has no Node/DOM globals.
  - Run gitleaks from PowerShell.
  - No 12-digit numbers in test data.
  - Vitest exits 1 with no test files.
  - `refs/original/` still holds the pre-rewrite commits (ask before deleting).
  - Don't open AWS before stage 4, and ask about placement season first.
  - Answer the Module 00/01 open questions before P1.3/P1.7.
  - Remove the broken pip `aws` before installing AWS CLI v2.
