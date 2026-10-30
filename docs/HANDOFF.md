# Handoff — latest session

Overwritten at the end of every session. Older handoffs are in git history: `git log -p docs/HANDOFF.md`.

**Session:** 5 — P0.4 API skeleton, 2026-10-30

**Done:**
- PR #3 (P0.3) was already squash-merged and its local branch deleted. Its remote branch `origin/chore/p0.3-database-compose` still exists on GitHub: delete it, or turn on "Automatically delete head branches".
- **Owner's requirement:** secrets, especially the future Claude API key, must never be readable by people who can see the public repo. Recorded in `docs/devops/secrets.md`: five leak paths (git, images, browser bundle, CI, logs), each with a rule, and how the Claude key is handled. Follow-up notes were added to P0.5, P0.6, stage 5 and Phase 3 in `PROGRESS.md`.
- Plan `docs/plans/2026-10-30-p0.4-api-skeleton.md`, approved and run inline, followed by one fresh review (Opus) of the whole branch.
- `packages/db`:
  - `createDatabase(url, onPoolError)`, where the pool error handler is required because an unhandled pg `error` event crashes Node;
  - `runMigrations(url)`;
  - the test helper `startTestDatabase()`, exported as `@business-software/db/testing` (`source` condition only).
- `apps/api` (NestJS 12, ESM, Express, written by hand):
  - `config.ts`: `DATABASE_URL` required; `HOST` defaults to `127.0.0.1`; `PORT` defaults to 3000. Errors name the variable, never its value.
  - `DatabaseModule`.
  - `HealthController`: `/api/health` (liveness) and `/api/health/ready` (`select 1`, 503 if it fails).
  - `errors.ts` `describeError`: messages along the `cause` chain only, cut at Drizzle's `params:`.
  - `run.ts` `runProcess`: wraps each entry point; a crash becomes one log line and exit 1.
  - `shutdown.ts` `waitForShutdown`: a keep-alive timer until SIGTERM/SIGINT.
  - `worker-app.ts` `createWorker`: an unreachable database is a warning, not a crash.
  - Entry points `main.ts`, `worker.ts`, `migrate.ts`.
- **Build:** a `tsconfig.build.json` per package (project references, `tsc -b`). Exports are `source` → `src`, `types`/`default` → `dist`; `customConditions: ["source"]` is in the base tsconfig, and Vitest uses `ssr.resolve.conditions`. A clean checkout passes `pnpm check` with no build.
- **Docker:**
  - `apps/api/Dockerfile`: multi-stage `node:24-slim`, Corepack pnpm, `pnpm deploy --prod`, `USER node`.
  - `.dockerignore`.
  - `compose.yaml`: `migrate` → `api` + `worker` (x-app anchor, `init: true`, `service_completed_successfully`, api `HOST: 0.0.0.0`, port `127.0.0.1:3000`).
  - Scripts: `pnpm db:up` (db only), `pnpm app:up`, `pnpm build`, `pnpm dev`.
- **Verified in Docker:**
  - db stopped → `/ready` 503, `/health` 200, then back to 200, with no restarts;
  - `docker compose stop` → exit 0 for both in about 0.7 s;
  - wrong owner password → migrate exit 1 with the reason and no password, and api and worker are never started;
  - worker started with the db down → a warning, and it stays up;
  - no `.env` or secrets in the image or `docker history`.
- ESLint: `no-extraneous-class` with `allowWithDecorator: true`, because a Nest module is a decorator-only class.
- **Docs:**
  - ADRs 0020 (build and runtime), 0021 (production migrations), 0022 (`app_queue` role for pg-boss, built in P2.7);
  - `architecture.md` (startup diagram), `local-database.md` (whole-app section), `git-workflow.md` (migration rebase rule), `CLAUDE.md` commands;
  - interview log (11 new entries, Q&A, glossary, Numbers), phase-0 journal.
- 84 tests: 45 shared, 12 db, 27 api.

**Half-done:** branch `chore/p0.4-api-skeleton` (10 commits plus this end-session commit) is committed but **not pushed**, and has no PR yet.

**Next step:**
1. Owner: `git push -u origin HEAD`, then `gh pr create --web`.
   - Title: `chore: build the nestjs api skeleton with docker and migrations (P0.4)`.
   - Fill in the template, with no "Generated with Claude Code" line.
   - Squash-merge (no CI yet), then `git switch main`, `git pull`, `git branch -D chore/p0.4-api-skeleton`.
2. Next session: `/start-session` → **P0.5 web skeleton**. Plan first. Read `docs/devops/secrets.md`: no `VITE_` secrets. The API is at `http://127.0.0.1:3000/api` (`pnpm dev` or `pnpm app:up`), and app and API share one domain (ADR 0011), so plan a dev proxy.

**Watch out for:**
- **No AI attribution, ever:** no `Co-Authored-By: Claude` and no "Generated with Claude Code" (`CLAUDE.md` rule 6 overrides tool defaults).
- **Log only `describeError(error)`, never error objects.** pg-pool attaches the client to idle-connection errors, and its password is a hidden property that `%o`, `showHidden` and test-runner serializers print. Drizzle messages carry query values (`params:`).
- **Signal listeners don't keep Node alive.** Anything that waits for SIGTERM needs `waitForShutdown()` (the timer) until pg-boss's polling exists. Check processes for longer than the slowest timer (pg's idle timeout is 10 s).
- **Windows can't send real SIGTERM** to a child process, so shutdown exit codes are only hand-checked in Docker. P0.6 should add a Linux smoke job (note in PROGRESS).
- **The first Docker build is slow** on this connection (about 12 min); later builds reuse the install layer. CI needs a layer cache.
- **Test data must not look like personal data:** a 10-digit number starting 6–9 trips the phone scan. Use values like `fake-session-token`.
- **Bash heredocs with apostrophes break** in the Windows shell tool. Write the text with the file tool, then append it.
- **Deferred minors from the final review:**
  - `describeError` gaps: an empty `AggregateError` message with `localhost` URLs, a cyclic `cause` loops forever, `cause: null` shows "a thrown object";
  - no query timeout on `/ready`;
  - `.dockerignore` should use `**/.env*`;
  - Node 25+ drops Corepack (note it in ADR 0020 before moving to `node:26-slim`).
- Carried over:
  - Docker Desktop must be running for `pnpm test`, `pnpm check`, `db:up` and `app:up`.
  - Never `docker compose down -v` without OK.
  - The bootstrap runs only on an empty volume.
  - P1.2's entry-log table must `REVOKE UPDATE`.
  - pnpm 12 `ERR_PNPM_IGNORED_BUILDS`: decide each package with a reason.
  - PowerShell 5.1 `Set-Content` writes a BOM.
  - TypeScript stays pinned to `~6.0`.
  - New `.ts` files must be in a tsconfig `include`.
  - `packages/shared` has no Node/DOM globals.
  - Run gitleaks from PowerShell.
  - `refs/original/` still holds the pre-rewrite commits (ask before deleting).
  - Don't open AWS before stage 4; ask about placement season first.
  - Answer the Module 00/01 open questions before P1.3/P1.7.
  - Remove the broken pip `aws` before installing AWS CLI v2.
