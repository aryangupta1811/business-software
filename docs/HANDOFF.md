# Handoff — latest session

Overwritten at the end of every session. Older handoffs are in git history: `git log -p docs/HANDOFF.md`.

**Session:** 13 — P1.1 merged; P1.2 entry log design started, 2026-11-01

**Done:**
- Pushed `feat/p1.1-tenancy` and opened **PR #9**; all five checks green; owner squash-merged it (`155d48b` on `main`). Local `feat/p1.1-tenancy` already deleted; the **remote** branch `origin/feat/p1.1-tenancy` still exists.
- Created `feat/p1.2-entry-log` from the updated `main`. (The owner re-ran `git switch -c` and got "already exists": harmless, the branch was already there; `-c` only creates.)
- Read ADR 0007, Module 06, ADR 0027 and `packages/db` (schema, tenancy, guard, roles test, migrations).
- **P1.2 design, with the owner** (spec `docs/plans/2026-11-01-p1.2-entry-log-design.md`, DRAFT):
  - Classified architectural; full path (spec → plan).
  - Owner chose **actor option A**: `actor_id` nullable uuid, no foreign key until P1.4 (NULL = the system).
  - Owner approved **section 1**: table `entry_log` with `before`/`after` jsonb, `action` as text (TypeScript list of names, no database enum), `business_id` defaulting to `app_current_business_id()`, composite `branch_id` key, `REVOKE UPDATE` from `app_runtime`.
  - **ADR 0028** written for the table shape (+ index row). PROGRESS P1.4 now carries the follow-up foreign key.

**Half-done:** the P1.2 design. Section 2 (the `recordEntry(tx, …)` helper, spec §3) was presented; the owner hasn't answered yet. Section 3 (guard-test changes, spec §4) not presented. No code written; no implementation plan.

**Next step:**
1. Owner (optional): delete the merged remote branch: `git push origin --delete feat/p1.1-tenancy` (or "Delete branch" on PR #9).
2. Owner: push this docs-only commit when convenient (`git push -u origin HEAD`). Don't open a PR yet: P1.2's code joins this branch, one PR per task.
3. Next session: `/start-session`, stay on `feat/p1.2-entry-log`. Re-present spec §3 (helper) for the owner's OK, then §4 (guard changes), resolve the open detail (can `packages/db` import the action list from `packages/shared`? check `packages/db/package.json`), finish the spec and ADR 0028, owner reviews the spec, then `superpowers:writing-plans` → `docs/plans/2026-11-01-p1.2-entry-log.md`.

**Watch out for:**
- **No AI attribution, ever:** no `Co-Authored-By: Claude` and no "Generated with Claude Code" (`CLAUDE.md` rule 6 overrides tool defaults).
- **P1.2 specifics:**
  - The migration must `REVOKE UPDATE ON entry_log FROM app_runtime`; test `UPDATE`/`DELETE`/`TRUNCATE` → `42501` (Drizzle wraps errors: code on `error.cause.code`; raw `pg` Pool has it on `error.code`).
  - `entry_log` is a normal tenant table: `businessId()`, `tenantPolicy`, hand-written `FORCE` in the migration, or the guard fails.
  - The guard's privilege rule currently allows UPDATE on every table; spec §4 adds an append-only rule for `entry_log`.
  - Module 06 is DRAFT: build recording only. No viewer, no flags, no retention policy (kept forever).
- **Design rules (web):**
  - Only tokens exist: `bg-surface`, `text-muted`, `text-body`; no `stone-*`, no `text-sm`. Text sizes are `text-label/body/section/title/figure`.
  - Tailwind needs whole class names in the source: never `` `bg-${x}` ``.
  - A new colour pair used for text must be added to the RULES in `src/theme/contrast.test.ts`.
  - Code that reads colours at runtime must accept short hex (`#fff`).
  - Modals use the native `<dialog>`, not Radix Dialog (CSP). Radix Tooltip is fine.
  - Shortcuts go through `useShortcut`; plain letters and the browser's keys are refused (ADR 0026).
- **CSP:** `script-src 'self'; style-src 'self'`. No inline scripts or styles. Check new libraries in the real build with the console open.
- **Every new string goes in all three locale files.** Hindi values must contain Devanagari; Hinglish none.
- **Review minors** are filed in PROGRESS under P1.2, P1.3, P1.4, P1.7, P1.13 and stage 7.
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
- **Tenancy rules (ADR 0027), enforced by `src/tenancy-guard.test.ts`:**
  - A new tenant table uses `id()`, `businessId()`, `createdAt()` and `tenantPolicy(t.businessId)`, and its migration adds `ALTER TABLE … FORCE ROW LEVEL SECURITY` by hand.
  - Keys into another tenant table are composite: `(business_id, x_id) → x(business_id, id)`, and `x` needs `unique (business_id, id)`.
  - Only one permissive policy (`tenant_isolation`); no materialized views or foreign tables for tenant data.
  - Code reaches tenant data only through `withBusiness(db, id, work)` / `withNewBusiness`; never pass a transaction.
  - A data migration as `app_owner` changes 0 rows unless it lifts `FORCE` inside its transaction; test the row count.
  - `pg_dump` as `app_owner` fails; never use `--enable-row-security` (empty tables). Backups need a `BYPASSRLS` role (stage 7).
- **Carried over:**
  - Docker Desktop must be running for `pnpm test`, `pnpm check`, `db:up` and `app:up`.
  - Never `docker compose down -v` without OK. The bootstrap runs only on an empty volume.
  - pnpm 12 `ERR_PNPM_IGNORED_BUILDS`: decide each package with a reason. A pre-existing peer warning (`eslint-plugin-jsx-a11y` wants ESLint ≤ 9) is known.
  - TypeScript stays pinned to `~6.0`. New `.ts`/`.tsx` files must be in a tsconfig `include`.
  - `packages/shared` has no Node/DOM globals; `apps/web` has no Node types (tests read files with Vite `?raw`).
  - Run gitleaks from PowerShell. Test data must not look like personal data.
  - `refs/original/` still holds the pre-rewrite commits (ask before deleting).
  - Don't open AWS before stage 4; ask about placement season first.
  - Answer the Module 00/01 open questions before P1.3/P1.7.
