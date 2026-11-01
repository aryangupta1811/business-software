# Handoff — latest session

Overwritten at the end of every session. Older handoffs are in git history: `git log -p docs/HANDOFF.md`.

**Session:** 11 — P1.1 tenancy & data safety (brainstorming, paused), 2026-11-01

**Done:**
- Phase 0 journal PR merged as #8 (session 10).
- Read ADRs 0006, 0007, 0019, `architecture.md` ("Who can see what"), Module 00 (business details, branches), and all of `packages/db` (bootstrap, migration 0000, client, migrate, testing helper, role tests).
- Brainstorming (superpowers, architectural path). Owner approved: **approach 1** (policies declared in the Drizzle schema through a helper, `FORCE` and the setting function hand-written in the same migration, a guard test over the catalogue); **tenancy-only columns** (signup fields wait for P1.3); the work lives in **`packages/db`** (no API route yet); **UUIDv7** from PostgreSQL 18's `uuidv7()`.
- Checked in `node_modules`: drizzle-orm 0.45 has `pgPolicy` (`for`, `to`, `using`, `withCheck`) and `enableRLS()`; drizzle-kit 0.31 writes `ENABLE ROW LEVEL SECURITY` but never `FORCE`.
- Everything so far is in the **draft spec** `docs/plans/2026-11-01-p1.1-tenancy-design.md`.
- Interview log: 3 entries, 1 question, 3 glossary terms.

**Half-done:** brainstorming for P1.1 on branch **`feat/p1.1-tenancy`** (one docs commit, not pushed). No code yet.

**Next step:**
1. `/start-session` will report the branch is `feat/p1.1-tenancy`, not `main`: that's expected. Stay on it (`git switch feat/p1.1-tenancy` if needed). Re-invoke `superpowers:brainstorming` and resume, reading only the draft spec.
2. Ask the owner whether **§3 (database objects)** looks right; it was presented in chat as "Section 1" and not yet answered.
3. Present §4 (`withBusiness`, schema helper, signup order, the P1.4 login-lookup problem) and §5 (tests), one at a time.
4. Finish the spec, self-review, owner reviews it, then `superpowers:writing-plans` → `docs/plans/2026-11-01-p1.1-tenancy.md`. Write **ADR 0027** (UUIDv7, policy helper, guard test) with the spec, via `/record-decision`.
5. No PR until the code is done: one PR for P1.1 holds the spec, plan, ADR and code.

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
- **P1.1 design gotchas:** a transaction-local setting reads back as `''` (not NULL) after its transaction ends, and `''::uuid` throws, so the function needs `nullif`. Signup must set the new business ID before inserting it. Drizzle can't generate `FORCE`.
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
