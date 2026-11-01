# Handoff — latest session

Overwritten at the end of every session. Older handoffs are in git history: `git log -p docs/HANDOFF.md`.

**Session:** 12 — P1.1 tenancy & data safety (design finished, built, reviewed), 2026-11-01

**Done:**
- Committed session 11's docs, then finished the design with the owner section by section: §3 database objects, §4 `withBusiness`, §5 tests. Spec `docs/plans/2026-11-01-p1.1-tenancy-design.md`, **ADR 0027**, plan `docs/plans/2026-11-01-p1.1-tenancy.md`. Owner chose **native** execution (inline, one fresh reviewer at the end).
- Checked on a throwaway PostgreSQL 18 before planning: an ended transaction-local setting reads back as `''`, `''::uuid` throws, `uuidv7()` gives version 7.
- **Built** (`packages/db`):
  - `migrations/0001_tenancy.sql`: `businesses`, `branches` (`unique (business_id, id)`), `tenant_isolation` policies (generated), plus hand-written `app_current_business_id()` and `FORCE ROW LEVEL SECURITY`.
  - `src/schema.ts`: tables and helpers `id()`, `businessId()`, `createdAt()`, `tenantPolicy()`.
  - `src/tenancy.ts`: `withBusiness`, `withNewBusiness`, `Transaction`; `src/client.ts`: `AppDatabase` (a type only a pooled database fits, so a transaction can't be passed in).
  - `src/tenancy.test.ts` (15 tests) and `src/tenancy-guard.test.ts` (8 rules, 16 probes; a removed `FORCE` line was caught).
- **Fresh review (opus):** 0 critical; all five Review Focus items held live. Three leaks past the guard fixed test-first (extra permissive policy; single-column keys between tenant tables, new `tenant_fk` rule; materialized views, new `kind` rule). `FORCE` traps documented: data migrations as `app_owner` change 0 rows; `pg_dump` as `app_owner` fails or writes empty tables. Eight minors filed in PROGRESS (P1.2, P1.4, P1.7, stage 7).
- **Checked:** `pnpm check` green, 241 tests (45 shared, 38 db, 28 api, 130 web); `drizzle-kit check` clean; migration applied to the local database.
- **Docs:** ADR 0027 + index; `architecture.md` (who can see what); `local-database.md` (tenant tables in psql, `FORCE` traps); new `docs/journal/phase-1.md`; interview log (5 entries, 1 question, 3 glossary terms, numbers, pitch).

**Half-done:** the P1.1 pull request: branch `feat/p1.1-tenancy` (8 commits including the end-session one), not pushed.

**Next step:**
1. Owner: `git push -u origin HEAD`, `gh pr create --web` with title `feat(db): add tenancy with forced row-level security (P1.1)`, fill in the template, **Squash and merge** when the five checks are green. Then `git switch main`, `git pull`, `git branch -D feat/p1.1-tenancy`.
2. Watch the `migrations` CI check: `0001` is new, so it must be newer than `main`'s `0000` (it is).
3. Next session: `/start-session` → **P1.2 entry log recording** (read ADR 0007, Module 06, ADR 0027, `packages/db/src/tenancy*.ts`; the P1.1 review minors filed under P1.2 belong in that task).

**Watch out for:**
- **No AI attribution, ever:** no `Co-Authored-By: Claude` and no "Generated with Claude Code" (`CLAUDE.md` rule 6 overrides tool defaults).
- **Design rules now enforced:**
  - Only tokens exist: `bg-surface`, `text-muted`, `text-body`; no `stone-*`, no `text-sm`. Text sizes are `text-label/body/section/title/figure`.
  - Tailwind needs whole class names in the source: never `` `bg-${x}` ``.
  - A new colour pair used for text must be added to the RULES in `src/theme/contrast.test.ts`.
  - Code that reads colours at runtime must accept short hex (`#fff`): the production minifier writes it.
  - Modals use the native `<dialog>`, not Radix Dialog (its runtime `<style>` breaks the CSP). Radix Tooltip is fine (it sets styles through JavaScript).
  - Shortcuts go through `useShortcut`; plain letters and the browser's keys are refused (ADR 0026).
- **CSP:** `script-src 'self'; style-src 'self'`. No inline scripts, no `<style>` tags or `style="…"` in HTML. Check new libraries in the real build with the console open.
- **Every new string goes in all three locale files.** Hindi values must contain Devanagari; Hinglish none.
- **Review minors** are filed in PROGRESS under P1.3 (layout heights, sticky sidebar, `/design` gaps, a11y details, `readSavedTheme`) and P1.13 (shortcut `preventDefault` on repeat, more reserved keys, clash only in dev, pause for any modal).
- **CI is the gate.** All five checks are required, and a PR must be up to date with `main`.
  - PR titles: lowercase Conventional Commit, at most 72 characters, no full stop.
  - GitHub's *Revert* button title fails: rename it to e.g. `fix: revert …`.
- **Migrations:** never edit, re-date or delete one that's on `main`. Add a new one instead.
- **A red `secrets` check fails every PR.** Revoke a real key first; for a false positive, add its fingerprint to `.gitleaksignore` in a PR; never commit a fake secret to a real branch.
- **Pinned versions:** Dependabot updates only `uses:` actions; the gitleaks and actionlint images are bumped by hand. New actions are pinned to a SHA with a `# vX.Y.Z` comment; `${{ github.event.* }}` values go through `env:`.
- **Shell gotchas:** never write repo files with PowerShell `Set-Content`/`Add-Content`/`Out-File` (BOM and CRLF). In Git Bash, no bare `cat > file` before a heredoc, and long Python with quotes goes in a scratchpad script file, not an inline heredoc.
- **Browser checks:** the Chrome window's size doesn't change the page width on this laptop (display scaling); constrain `<html>` width in JavaScript to test narrow layouts.
- **Deferred minors (older):**
  - From P0.6: the "reproduce `check`" row in `git-workflow.md` lacks the actionlint command; the repo setting *Require actions to be pinned to a full-length commit SHA* is off (owner decides).
  - From P0.5: an asset URL with a trailing slash gets a 308 with the immutable header; a Caddyfile edit reruns the Vite build; no fake-timer test of a hanging fetch; polling pauses in background tabs.
  - From P0.4: `describeError` gaps (an empty `AggregateError`, a cyclic `cause`, `cause: null`); no query timeout on `/ready`; Node 25+ drops Corepack (note it in ADR 0020 before `node:26-slim`).
- **Tenancy rules (ADR 0027), enforced by `src/tenancy-guard.test.ts`:**
  - A new tenant table uses `id()`, `businessId()`, `createdAt()` and `tenantPolicy(t.businessId)`, and its migration adds `ALTER TABLE … FORCE ROW LEVEL SECURITY` by hand (drizzle-kit can't).
  - Keys into another tenant table are composite: `(business_id, x_id) → x(business_id, id)`, and `x` needs `unique (business_id, id)`.
  - Only one permissive policy (`tenant_isolation`); no materialized views or foreign tables for tenant data.
  - Code reaches tenant data only through `withBusiness(db, id, work)` / `withNewBusiness`; never pass a transaction (it won't type-check).
  - A data migration as `app_owner` changes 0 rows unless it lifts `FORCE` inside its transaction; test the row count.
  - `pg_dump` as `app_owner` fails; never use `--enable-row-security` (empty tables). Backups need a `BYPASSRLS` role (stage 7).
  - Drizzle wraps driver errors: the PostgreSQL code is on `error.cause.code`.
- **Carried over:**
  - Docker Desktop must be running for `pnpm test`, `pnpm check`, `db:up` and `app:up`.
  - Never `docker compose down -v` without OK. The bootstrap runs only on an empty volume.
  - P1.2's entry-log table must `REVOKE UPDATE`.
  - pnpm 12 `ERR_PNPM_IGNORED_BUILDS`: decide each package with a reason. A pre-existing peer warning (`eslint-plugin-jsx-a11y` wants ESLint ≤ 9) is known.
  - TypeScript stays pinned to `~6.0`. New `.ts`/`.tsx` files must be in a tsconfig `include`.
  - `packages/shared` has no Node/DOM globals; `apps/web` has no Node types (tests read files with Vite `?raw`).
  - Run gitleaks from PowerShell. Test data must not look like personal data.
  - `refs/original/` still holds the pre-rewrite commits (ask before deleting).
  - Don't open AWS before stage 4; ask about placement season first.
  - Answer the Module 00/01 open questions before P1.3/P1.7.
