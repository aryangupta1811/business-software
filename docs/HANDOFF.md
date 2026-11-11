# Handoff — latest session

Overwritten at the end of every session. Older handoffs are in git history: `git log -p docs/HANDOFF.md`.

**Session:** 17 — Deep scan, then a plan and technology review, 2026-11-10

**Done:**
- The stage 4 docs PR was already merged as **#12**. `main` is synced.
- **Deep scan** (owner's request, before opening the AWS account), on branch `fix/deep-scan-findings`. Every source file, migration, workflow, Dockerfile and the plan were read; a live test database was attacked 18 ways as `app_runtime`. Tenant isolation and the no-delete rules held.
- **Four bugs fixed, each with a test that failed first:**
  1. `packages/db/src/client.ts`: a connection lost in the middle of a transaction crashed the whole process (pg-pool listens for `error` only on idle connections). Every connection now has a listener.
  2. `apps/api/src/error-filter.ts` (new, installed in `app.ts`): Nest's default handler logs the error object, so a request failing on a query would have logged its values and PostgreSQL's `detail` line. `UnhandledErrorFilter` logs one `describeError` line and answers a plain 500.
  3. `apps/api/src/run.ts`: `runProcess` now also handles `uncaughtException` and `unhandledRejection` (one safe line, exit 1).
  4. `apps/api/src/errors.ts`: `describeError` gave an empty reason for a refused connection to `localhost` (`AggregateError`), spun for ever on a looping `cause` chain, and misreported `cause: null`.
- Small fixes: the file name in `compose.yaml`'s comment, the README's status line.
- **Plan gaps** written into `PROGRESS.md` under P1.3, P1.4, P1.8, P1.20, P2.7 and stage 5 (each marked "From the 2026-11-10 scan").
- Docs: `secrets.md` rule 5, `architecture.md` (what happens when something fails), `phase-1.md`, interview log (6 entries, 4 questions, 4 glossary terms, 272 tests).
- **Plan and technology review** (owner's second request; `docs/plans/2026-11-10-plan-review.md`). Every technology was checked against what is installed, the npm registry, official pages and experiments. Verdict: keep the stack. What the experiments corrected:
  - **pg-boss** can't start as ADR 0022 describes: it needs `createSchema: false` (dated note in ADR 0022; under P2.7).
  - **The server is ARM64, CI builds x86.** Both images were built and run for `linux/arm64` on the laptop; the deploy stage must build on GitHub's ARM64 runner (dated note in ADR 0011; under stages 5 and 6).
  - **No SWC plugin needed:** Vitest 5 keeps decorator metadata (dated note in ADR 0013; under P1.3).
  - **Argon2id is built into Node 24** (`crypto.argon2`), also in the ARM64 image (under P1.4).
  - ICU collations (`hi-x-icu`) are in the `postgres:18` image (under P1.7). `pnpm audit --prod` is clean; 3 moderate advisories in development tools only.
- **Owner's answers (2026-11-10):** placement interviews are **1 to 3 months away** (so "close", not "closed"). The order of work is now **demo-first**: PROGRESS's Phase 1 was re-ordered (same tasks and numbers): cloud stages 5, 6, 7 first, then signup, login, items, stock, billing, printing, then udhaar and demo data, then the deferred tasks (P1.5, P1.6, P1.9–P1.11, P1.16, P1.17, P1.19).
- `pnpm check` and `pnpm build` are green: **272 tests** (45 shared, 60 db, 37 api, 130 web). The compiled API was started by hand and answered 200, 503, 404 and 400 correctly.

**Half-done:**
- The PR for branch `fix/deep-scan-findings` (committed, not pushed, not merged). CI's `smoke` job hasn't run on it yet: it's the only check that can't run on Windows.
- The local branch `docs/devops-stage-4` still exists (merged as #12). Claude's delete was blocked by the permission mode: `git branch -D docs/devops-stage-4`.
- **Stage 4 itself:** the owner does the AWS runbook's steps A–E. Nothing has been created in AWS yet.

**Next step:**
1. Owner: `git push -u origin HEAD`, `gh pr create --web` with title `fix(api): survive a lost connection and keep query values out of logs`, fill in the template, **Squash and merge** when the five checks are green. Then `git switch main`, `git pull`, `git branch -D fix/deep-scan-findings`.
2. Owner: open the AWS account with `docs/devops/aws-account.md`, steps A–E.
3. Next session: `/start-session`, then check stage 4 together (step F), plan the credit activities that launch a server or database so nothing is left running, and tick stage 4. Then **DevOps stage 5 (Terraform)**, which now comes before P1.3: first decide how the laptop's CLI gets short-lived credentials (ADR 0029), and state the expected cost before creating anything. Its PROGRESS line carries the notes from both reviews (ARM64, swap, the real host name in `DATABASE_URL`).
4. A small PR any time: the **dependency refresh** task in PROGRESS.
5. **Owner decisions waiting** (in PROGRESS): whether `entry_log`'s `id` and `created_at` become database-only (P1.4 e); what a visitor may do in the public demo and how it resets (P1.20); whether a thin AI slice comes right after demo data v1 (end of step 3).

**Watch out for:**
- **Demo-first order (2026-11-10):** work PROGRESS's Phase 1 from top to bottom. These make the deferrals safe and affordable, so keep them:
  - P1.3's signup creates the business's first branch.
  - From P1.4 on, every route names the permission it needs (the owner has them all), so P1.5 only adds staff logins and switches.
  - P1.8's stock ledger leaves room for a batch and a serial number, so P1.10 isn't a rewrite.
  - Stage 7 (backups, restore drill) must be done before P1.3 stores the first real data.
  - The server and database cost credits from stage 5 on: stop them by hand after each session until stage 7's schedule exists.
- **Checked facts not to rediscover:** pg-boss needs `createSchema: false`; images must be built for `linux/arm64`; no SWC plugin; `crypto.argon2` exists; TypeScript stays `~6.0` and Drizzle stays 0.45 (1.0 is still a release candidate).
- **Failure paths (2026-11-10 scan):**
  - For an answer the client should see, throw one of Nest's `HttpException`s. Anything else that escapes a request becomes a 500 and one log line through `UnhandledErrorFilter`. Never `logger.error(error)` with an object: `describeError(error)` only.
  - `createDatabase` keeps an `error` listener on every connection. Any other `new Pool` (like the one in `runMigrations`) has none: a dropped connection there ends the process through `runProcess`'s crash handler, which is right for `migrate`.
  - `runProcess` owns `uncaughtException` and `unhandledRejection`. Don't add other listeners for them.
  - A test for "the database goes away" must cover a connection that is in use, not only an idle one.
- **AWS (ADR 0029, runbook):**
  - Never join or create an AWS Organization, set up Control Tower, or turn on Identity Center's organization instance while on the Free plan: it upgrades to Paid, irreversibly.
  - One account only, in the owner's own name.
  - The 6-month clock started at sign-up (date it in PROGRESS once the owner reports it). Credit activities must be done within 6 months; earned credits expire 12 months after sign-up.
  - Before creating anything, state its expected cost against the remaining credits (ADR 0011). RDS restarts itself after 7 days stopped.
  - Never commit the account ID, sign-in alias or link, root email or passwords.
  - The 2026-10-29 interview log entry (`aws sso login`) describes the old plan; stage 5 decides the laptop's short-lived CLI credentials (check what the installed AWS CLI v2 offers; no long-lived access keys if avoidable).
- **No AI attribution, ever:** no `Co-Authored-By: Claude` and no "Generated with Claude Code" (`CLAUDE.md` rule 6 overrides tool defaults).
- **Module 00 rules that shape P1.3/P1.4:**
  - Owner email is unique **across all businesses** (#27): a global unique index, outside RLS's per-business view. The login lookup is the narrow cross-business path (ADR 0027), a `SECURITY DEFINER` function on `DEFINER_ALLOWED`.
  - Staff usernames are unique **within a business**: `unique (business_id, username)` (also the P1.7 rule that every tenant unique key includes `business_id`).
  - The recovery key and reset tokens are random bytes stored only as hashes; never UUIDv7 (ADR 0027).
  - Sending email is new infrastructure: P1.4 needs an ADR (e.g. SES in the cloud, Mailpit locally). SES needs a verified domain (stage 5) and leaving its sandbox. The secret rules in `docs/devops/secrets.md` apply.
  - Auto-lock (owner, 5 min) and staff idle logout (30 min) are per-business settings.
- **Entry log rules (ADR 0028):**
  - Write only through `recordEntry(tx, …)` inside the action's own `withBusiness` transaction; never `tx.insert(entryLog)` (the table is still exported; P2.6 should stop that).
  - A new action goes into `ENTRY_ACTIONS` with `reasonRequired`.
  - `actorId` is the logged-in person, or `null` only for the system.
  - Order entries by `id`, not `created_at` (entries in one transaction share `now()`).
  - Fix a wrong entry by recording a correcting one; `app_runtime` can't UPDATE or DELETE it.
- **Guard rules (`src/tenancy-guard.test.ts`):** every view needs `with (security_invoker = true)`; no column-level UPDATE on an `APPEND_ONLY` table; a `SECURITY DEFINER` function the app can run must be on `DEFINER_ALLOWED` with its reason (P1.4's login lookup: also revoke PUBLIC and pin `search_path`); exactly one `app_current_business_id()`; `app_runtime` belongs to no role; a new non-tenant schema goes on `NOT_TENANT_SCHEMAS` with its reason.
- **Test helper:** `startTestDatabase().adminUrl` is the superuser on the app database (`business_software`); use it for roles and schemas, which `app_owner` can't create.
- **Tenancy rules (ADR 0027):**
  - A new tenant table uses `id()`, `businessId()`, `createdAt()` and `tenantPolicy(t.businessId)`, and its migration adds `ALTER TABLE … FORCE ROW LEVEL SECURITY` by hand.
  - Keys into another tenant table are composite: `(business_id, x_id) → x(business_id, id)`, and `x` needs `unique (business_id, id)`.
  - Only one permissive policy (`tenant_isolation`); no materialized views or foreign tables for tenant data.
  - Code reaches tenant data only through `withBusiness(db, id, work)` / `withNewBusiness`; never pass a transaction.
  - A data migration as `app_owner` changes 0 rows unless it lifts `FORCE` inside its transaction; test the row count.
  - `pg_dump` as `app_owner` fails; never use `--enable-row-security` (empty tables). Backups need a `BYPASSRLS` role (stage 7).
  - Drizzle wraps driver errors: the PostgreSQL code is on `error.cause.code` (a raw `pg` Pool: `error.code`). RLS `WITH CHECK` runs before NOT NULL, so a missing business gives `42501`.
- **Design rules (web):**
  - Only tokens exist: `bg-surface`, `text-muted`, `text-body`; no `stone-*`, no `text-sm`. Text sizes are `text-label/body/section/title/figure`.
  - Tailwind needs whole class names in the source: never `` `bg-${x}` ``.
  - A new colour pair used for text must be added to the RULES in `src/theme/contrast.test.ts`.
  - Code that reads colours at runtime must accept short hex (`#fff`).
  - Modals use the native `<dialog>`, not Radix Dialog (CSP). Radix Tooltip is fine.
  - Shortcuts go through `useShortcut`; plain letters and the browser's keys are refused (ADR 0026).
- **CSP:** `script-src 'self'; style-src 'self'`. No inline scripts or styles. Check new libraries in the real build with the console open.
- **Every new string goes in all three locale files.** Hindi values must contain Devanagari; Hinglish none.
- **Review minors** are filed in PROGRESS under P1.3, P1.4, P1.7, P1.13, P2.6 and stage 7.
- **CI is the gate.** All five checks are required, and a PR must be up to date with `main`.
  - PR titles: lowercase Conventional Commit, at most 72 characters, no full stop.
  - GitHub's *Revert* button title fails: rename it to e.g. `fix: revert …`.
- **Migrations:** never edit, re-date or delete one that's on `main`. Add a new one instead.
- **A red `secrets` check fails every PR.** Revoke a real key first; for a false positive, add its fingerprint to `.gitleaksignore` in a PR; never commit a fake secret to a real branch.
- **gitleaks isn't installed locally:** run it with the Docker command in `docs/devops/git-workflow.md` (PowerShell, Docker Desktop running).
- **Pinned versions:** Dependabot updates only `uses:` actions; the gitleaks and actionlint images are bumped by hand. New actions are pinned to a SHA with a `# vX.Y.Z` comment; `${{ github.event.* }}` values go through `env:`.
- **Shell gotchas:** never write repo files with PowerShell `Set-Content`/`Add-Content`/`Out-File` (BOM and CRLF). In Git Bash, no bare `cat > file` before a heredoc, and long Python with quotes goes in a scratchpad script file.
- **Git:** after a squash merge, `git branch -d` refuses (git can't see the commits in `main`); use `-D`. `git switch -c` only creates; to move onto an existing branch use `git switch <name>`.
- **Browser checks:** the Chrome window's size doesn't change the page width on this laptop (display scaling); constrain `<html>` width in JavaScript to test narrow layouts.
- **Deferred minors (older):**
  - From P0.6: the "reproduce `check`" row in `git-workflow.md` lacks the actionlint command; the repo setting *Require actions to be pinned to a full-length commit SHA* is off (owner decides).
  - From P0.5: an asset URL with a trailing slash gets a 308 with the immutable header; a Caddyfile edit reruns the Vite build; no fake-timer test of a hanging fetch; polling pauses in background tabs.
  - From P0.4: no query timeout on `/ready` (P1.8 sets timeouts); Node 25+ drops Corepack (note it in ADR 0020 before `node:26-slim`).
- **Carried over:**
  - Docker Desktop must be running for `pnpm test`, `pnpm check`, `db:up` and `app:up`.
  - Never `docker compose down -v` without OK. The bootstrap runs only on an empty volume.
  - pnpm 12 `ERR_PNPM_IGNORED_BUILDS`: decide each package with a reason. A pre-existing peer warning (`eslint-plugin-jsx-a11y` wants ESLint ≤ 9) is known.
  - TypeScript stays pinned to `~6.0`. New `.ts`/`.tsx` files must be in a tsconfig `include`. `exactOptionalPropertyTypes` is on: leave an optional property out instead of setting it to `undefined`.
  - `packages/shared` has no Node/DOM globals; `apps/web` has no Node types (tests read files with Vite `?raw`).
  - Test data must not look like personal data.
  - `refs/original/` still holds the pre-rewrite commits (ask before deleting).
  - Answer the Module 01 open questions before P1.7.
