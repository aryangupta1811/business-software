# Handoff — latest session

Overwritten at the end of every session. Older handoffs are in git history: `git log -p docs/HANDOFF.md`.

**Session:** 10 — Phase 0 journal, 2026-11-01

**Done:**
- `docs/journal/phase-0.md`: status "Done" (3 days, 9 sessions, 7 PRs), a one-line summary, and a new **Looking back** section (what worked, what I'd do differently, what carries into Phase 1). The section is now in the template in `docs/journal/README.md`, so later phases have it too.
- `docs/journal/INTERVIEW_LOG.md`: the **2-minute pitch** written (problem → what makes it hard → architecture → hard bug: the worker that died at 10 s → how it's shipped → where it stands → what I'd do differently); Numbers row for Phase 0; stale "130 tests" in the CI-time row clarified; Question bank item "Why a whole phase without features?"; log entry for this session.
- `docs/PROGRESS.md`: Phase 0 journal ticked; focus moved to Phase 1.
- Docs only, no code. `pnpm format:check` green.

**Half-done:** the PR for `docs/phase-0-journal` (docs only); it needs green CI and the owner's squash-merge.

**Next step:**
1. Owner: push, open the PR, squash-merge when the five checks are green; then `git switch main`, `git pull`, `git branch -D docs/phase-0-journal`.
2. Next session: `/start-session` → **P1.1 tenancy & data safety** (read ADRs 0006 and 0007, `docs/architecture.md`, `docs/devops/local-database.md`, and `packages/db/src/roles.test.ts` for the test style).
3. Update the pitch's "how it's shipped" and "where it stands" lines whenever a phase finishes.

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
