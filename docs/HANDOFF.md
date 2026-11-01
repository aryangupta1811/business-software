# Handoff — latest session

Overwritten at the end of every session. Older handoffs are in git history: `git log -p docs/HANDOFF.md`.

**Session:** 13–14 — P1.1 merged; P1.2 entry log designed, built and reviewed, 2026-11-01 to 2026-11-02

**Done:**
- P1.1 merged as **PR #9** (all five checks green). Its local and remote branches are gone.
- **P1.2 design** with the owner, section by section: actor option A (nullable `actor_id`, no key until P1.4), `before`/`after` jsonb, the `recordEntry` helper, the guard changes. Spec `docs/plans/2026-11-01-p1.2-entry-log-design.md`, **ADR 0028**, plan `docs/plans/2026-11-02-p1.2-entry-log.md`. Owner chose **native** execution.
- **Built** (`packages/db`):
  - `migrations/0002_entry_log.sql`: `entry_log` (generated) plus hand-written `FORCE ROW LEVEL SECURITY` and `REVOKE UPDATE … FROM app_runtime`.
  - `src/schema.ts`: `entryLog` (`business_id` defaults to `app_current_business_id()`, composite `entry_log_branch_fk`).
  - `src/entry-log.ts`: `ENTRY_ACTIONS` (`stock.adjusted` needs a reason), `EntryAction`, `EntryInput`, `recordEntry(tx, entry)`; runtime refusal of `actorId: undefined`.
  - `src/entry-log.test.ts` (17 tests); `src/tenancy-guard.test.ts` widened (effective and column privileges, every non-system schema with `drizzle` exempt, `business_fk`, `append_only`, `view`, `definer` with `DEFINER_ALLOWED`, exact `function_pin`, role membership; 28 probes); `src/testing.ts` `adminUrl` now on the app database.
- **Fresh review (opus):** 0 critical; Review Focus all held live; 4 important + 1 minor re-graded important, all fixed test-first (views, column grants, definer granted to the app, overloaded pin function, `actorId` undefined). 7 minors filed in PROGRESS (P1.4, P1.7, P2.6).
- **Checked:** `pnpm check` green, 262 tests (45 shared, 59 db, 28 api, 130 web); `drizzle-kit check` clean; migration order OK; migration applied to the local database; guard proven on the real migration (removing `REVOKE UPDATE` fails it with `entry_log: append_only`).
- **Docs:** ADR 0028 + index; `architecture.md`; `local-database.md` ("The entry log"); `phase-1.md`; interview log (5 entries, 4 questions, 6 glossary terms, numbers, pitch).

**Half-done:** the P1.2 pull request: branch `feat/p1.2-entry-log` (9 commits including the end-session one; only the first is pushed), not merged.

**Next step:**
1. Owner: `git push -u origin HEAD`, `gh pr create --web` with title `feat(db): add the append-only entry log (P1.2)`, fill in the template, **Squash and merge** when the five checks are green. Then `git switch main`, `git pull`, `git branch -D feat/p1.2-entry-log`.
2. Watch the `migrations` check: `0002` is new and must be newer than `main`'s `0001` (it is; checked locally).
3. Next session: `/start-session`, then choose: **DevOps stage 4** (first ask when placement season is) or answering **Module 00's open questions** (auto-lock time, password reset, deactivation, counters) before P1.3.

**Watch out for:**
- **No AI attribution, ever:** no `Co-Authored-By: Claude` and no "Generated with Claude Code" (`CLAUDE.md` rule 6 overrides tool defaults).
- **Entry log rules (ADR 0028):**
  - Write only through `recordEntry(tx, …)` inside the action's own `withBusiness` transaction; never `tx.insert(entryLog)` (the table is still exported; P2.6 should stop that).
  - A new action goes into `ENTRY_ACTIONS` with `reasonRequired`.
  - `actorId` is the logged-in person, or `null` only for the system.
  - Order entries by `id`, not `created_at` (entries in one transaction share `now()`).
  - Fix a wrong entry by recording a correcting one; `app_runtime` can't UPDATE or DELETE it.
- **Guard rules now enforced (`src/tenancy-guard.test.ts`):** every view needs `with (security_invoker = true)`; no column-level UPDATE on an `APPEND_ONLY` table; a `SECURITY DEFINER` function the app can run must be on `DEFINER_ALLOWED` with its reason (P1.4's login lookup: also revoke PUBLIC and pin `search_path`); exactly one `app_current_business_id()`; `app_runtime` belongs to no role; a new non-tenant schema goes on `NOT_TENANT_SCHEMAS` with its reason.
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
- **Pinned versions:** Dependabot updates only `uses:` actions; the gitleaks and actionlint images are bumped by hand. New actions are pinned to a SHA with a `# vX.Y.Z` comment; `${{ github.event.* }}` values go through `env:`.
- **Shell gotchas:** never write repo files with PowerShell `Set-Content`/`Add-Content`/`Out-File` (BOM and CRLF). In Git Bash, no bare `cat > file` before a heredoc, and long Python with quotes goes in a scratchpad script file.
- **Git:** after a squash merge, `git branch -d` refuses (git can't see the commits in `main`); use `-D`. `git switch -c` only creates; to move onto an existing branch use `git switch <name>`.
- **Browser checks:** the Chrome window's size doesn't change the page width on this laptop (display scaling); constrain `<html>` width in JavaScript to test narrow layouts.
- **Deferred minors (older):**
  - From P0.6: the "reproduce `check`" row in `git-workflow.md` lacks the actionlint command; the repo setting *Require actions to be pinned to a full-length commit SHA* is off (owner decides).
  - From P0.5: an asset URL with a trailing slash gets a 308 with the immutable header; a Caddyfile edit reruns the Vite build; no fake-timer test of a hanging fetch; polling pauses in background tabs.
  - From P0.4: `describeError` gaps (an empty `AggregateError`, a cyclic `cause`, `cause: null`); no query timeout on `/ready`; Node 25+ drops Corepack (note it in ADR 0020 before `node:26-slim`).
- **Carried over:**
  - Docker Desktop must be running for `pnpm test`, `pnpm check`, `db:up` and `app:up`.
  - Never `docker compose down -v` without OK. The bootstrap runs only on an empty volume.
  - pnpm 12 `ERR_PNPM_IGNORED_BUILDS`: decide each package with a reason. A pre-existing peer warning (`eslint-plugin-jsx-a11y` wants ESLint ≤ 9) is known.
  - TypeScript stays pinned to `~6.0`. New `.ts`/`.tsx` files must be in a tsconfig `include`. `exactOptionalPropertyTypes` is on: leave an optional property out instead of setting it to `undefined`.
  - `packages/shared` has no Node/DOM globals; `apps/web` has no Node types (tests read files with Vite `?raw`).
  - Run gitleaks from PowerShell. Test data must not look like personal data.
  - `refs/original/` still holds the pre-rewrite commits (ask before deleting).
  - Don't open AWS before stage 4; ask about placement season first.
  - Answer the Module 00/01 open questions before P1.3/P1.7.
