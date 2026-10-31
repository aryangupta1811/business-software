# Handoff — latest session

Overwritten at the end of every session. Older handoffs are in git history: `git log -p docs/HANDOFF.md`.

**Session:** 9 — P0.7 design system, 2026-10-31 (continued from session 8's brainstorming)

**Done:**
- **Design chosen by the owner** from browser mockups (superpowers visual companion, files in the git-ignored `.superpowers/brainstorm/`):
  - Apple-clean (cool white, one blue accent); 8 px corners; IBM Plex Sans + Plex Sans Devanagari; light by default with a sun/moon button; `/design` page in the live app, not in the sidebar.
  - Spec `docs/plans/2026-10-31-p0.7-design-system-design.md`, plan `docs/plans/2026-10-31-p0.7-design-system.md` (8 tasks, run inline, then one fresh reviewer).
- **Built** (`apps/web`):
  - `src/styles.css`: tokens as CSS variables (`:root` light, `.dark`), mapped with `@theme inline`; Tailwind's default colours and text sizes removed (`--color-*: initial`, `--text-*: initial`); Hindi raises every `--text-*--line-height` to 1.6 under `html[lang='hi']`.
  - `src/theme/contrast.ts` + test (WCAG ratios over both modes, reads `styles.css?raw`; Vitest needed `css.include` for that); `typography.test.ts` (Hindi line heights).
  - Light/dark: `src/theme/theme.ts`, `public/theme-init.js` (loaded in `<head>`, no dark flash), `components/theme-toggle.tsx`.
  - `src/components/ui/`: Button, Input, Label, Field, Card, Badge, Kbd, Tooltip (shadcn source copied by hand, no CLI); `src/lib/cn.ts` (tailwind-merge taught our text sizes).
  - `components/app-shell.tsx`: sidebar (Home with `Alt+H` chip, "Keyboard shortcuts `?`" button) + top bar (title from route `staticData.titleKey`, connection badge, language switcher, theme button). Badge, switcher, home, not-found, error screen restyled.
  - `src/shortcuts/`: `keys.ts`, `registry.ts`, `context.ts`, `use-shortcut.ts`, `shortcut-provider.tsx`, `shortcut-help.tsx` (native `<dialog>`; jsdom polyfill in `src/test/setup.ts`).
  - `public/favicon.svg` + `favicon.ico`; `src/routes/design.tsx`; `scripts/ci/smoke.sh` check 5b (favicon is an image).
- **Checked:** `pnpm check` green (224 tests: 45 shared, 21 db, 28 api, 130 web); smoke test 8/8; Chrome through Caddy: no CSP violations, fonts from our origin, six mode × language combinations, no overflow at 1024 px, Hindi line height 1.6, help button works.
- **Bugs found and fixed:** contrast test rejected two approved colours (links → `#0066cc`, success → `#1b7a42`); the real build's minifier writes `#fff`, which broke `/design`'s ratios; the final review's three important findings (grey-on-grey switcher → light `--muted` `#67676c`; Hindi spacing overridden by `text-*` classes; no visible way into the shortcut list and `?` untypable on Inscript).
- **Docs:** ADRs 0025 (design system) and 0026 (shortcuts, native dialog) + index; `architecture.md`; PROGRESS (P0.7 ticked; review minors filed under P1.3 and P1.13); phase-0 journal; interview log (10 entries, 2 questions, 5 glossary terms, numbers).

**Half-done:** the P0.7 pull request (`feat/p0.7-design-system`) is open; it needs green CI and the owner's squash-merge.

**Next step:**
1. Owner: when the five checks are green, review the PR on GitHub and **Squash and merge** (keep the title).
2. Then `git switch main`, `git pull`, `git branch -D feat/p0.7-design-system`.
3. Next session: `/start-session` → **P1.1 tenancy & data safety**, or first close Phase 0 by finishing `docs/journal/phase-0.md` (status line still says "In progress"; the 2-minute pitch in the interview log is still empty).

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
