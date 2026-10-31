# Handoff — latest session

Overwritten at the end of every session. Older handoffs are in git history: `git log -p docs/HANDOFF.md`.

**Session:** 8 — P0.7 design system (started), 2026-10-31

**Done:**
- PR #6 (P0.6 CI) was already squash-merged; `main` was clean and up to date.
- Created branch `feat/p0.7-design-system` from the latest `main`.
- Started brainstorming P0.7 (superpowers brainstorming skill), classified as **architectural**: questions → 2–3 approaches → design approved section by section → written spec → plan in `docs/plans/` → owner approves → build.
- Read the current web app: `apps/web/src/styles.css` is only `@import 'tailwindcss'` (no tokens); the header in `src/routes/__root.tsx`, `components/connection-badge.tsx` and `components/language-switcher.tsx` use plain `stone-*` Tailwind classes, all placeholders to restyle. shadcn/ui is not installed yet (ADR 0003 already chose it).
- Wrote back the understanding to the owner (not yet confirmed or corrected):
  - **Owner said** (docs): modern and clean, not "AI slop"; easy for shopkeepers; counter computer with keyboard, scanner and receipt printer, no phones; billing fast by keyboard and scanner; English, Hindi and Hinglish.
  - **Claude assumed:** success = tokens (colour, type, spacing) + restyled shadcn base components + restyled header + favicon + a keyboard-shortcut framework, so P1.3 needs no design decisions; dense, calm screens (bills, stock, ledgers), not airy marketing style; a font with good Devanagari and room for taller Hindi lines.
  - **Constraint from code:** the Caddy CSP (`apps/web/Caddyfile`) has `font-src 'self'` and `style-src 'self'`, so fonts and icons must be self-hosted.
- Interview log: one entry ("A design system starts from constraints, not taste").

**Half-done:** P0.7 brainstorming, on branch `feat/p0.7-design-system`. No code yet; only this end-session docs commit is on the branch.

**Next step:**
1. `/start-session`, then `git switch feat/p0.7-design-system` (don't create a new branch).
2. Ask the owner to confirm or correct the understanding above.
3. The open question, asked but not answered: **which apps or websites do they like the look of, and what about each?** (Examples offered: Zerodha Kite, PhonePe, Swiggy, Khatabook, Vyapar, Linear, Notion, Stripe; or "none, show me directions".)
4. Then, one question at a time: colours (any brand colour in mind?), light or dark first, then any remaining questions. Offer the visual companion (browser mockups) only when a question is truly visual, such as comparing directions.
5. Propose 2–3 visual directions with a recommendation → design sections → spec → plan in `docs/plans/` → owner OK → build. Record the font, icon set and shortcut library choices as ADRs.

**Watch out for:**
- **No AI attribution, ever:** no `Co-Authored-By: Claude` and no "Generated with Claude Code" (`CLAUDE.md` rule 6 overrides tool defaults).
- **Don't open a PR for P0.7 until it's built.** Pushing the branch as a backup is fine.
- **P0.7 notes in PROGRESS:** self-host fonts; check every layout in English, Hindi and Hinglish; add shadcn/ui; add a favicon (today `/favicon.ico` gets the SPA fallback HTML).
- **CSP:** `style-src 'self'` blocks `<style>` tags and `style="…"` attributes in HTML. Check that any library we add (shadcn, Radix, a toast or shortcut library) doesn't inject them, and test the built app through Caddy (`pnpm app:up`, http://127.0.0.1:8080) with the console open.
- **Every new string goes in all three locale files.** Hinglish must not contain Devanagari.
- **CI is the gate.** All five checks are required, and a PR must be up to date with `main`.
  - PR titles: lowercase Conventional Commit, at most 72 characters, no full stop.
  - GitHub's *Revert* button title fails: rename it to e.g. `fix: revert …`.
- **Migrations:** never edit, re-date or delete one that's on `main`. Add a new one instead.
- **A red `secrets` check fails every PR.** Revoke a real key first; for a false positive, add its fingerprint to `.gitleaksignore` in a PR; never commit a fake secret to a real branch.
- **Pinned versions:** Dependabot updates only `uses:` actions; the gitleaks and actionlint images are bumped by hand. New actions are pinned to a SHA with a `# vX.Y.Z` comment; `${{ github.event.* }}` values go through `env:`.
- **Never write repo files with PowerShell `Set-Content`/`Add-Content`/`Out-File`** (BOM and CRLF). In Git Bash, don't chain a bare `cat > file` before a heredoc: it waits on stdin and hangs. Use the editor tools or a script file in the scratchpad.
- **Deferred minors:**
  - From P0.6: the "reproduce `check`" row in `git-workflow.md` lacks the actionlint command; the repo setting *Require actions to be pinned to a full-length commit SHA* is off (owner decides).
  - From P0.5: an asset URL with a trailing slash gets a 308 with the immutable header; a Caddyfile edit reruns the Vite build; no fake-timer test of a hanging fetch; polling pauses in background tabs.
  - From P0.4: `describeError` gaps (an empty `AggregateError`, a cyclic `cause`, `cause: null`); no query timeout on `/ready`; Node 25+ drops Corepack (note it in ADR 0020 before `node:26-slim`).
- **Carried over:**
  - Docker Desktop must be running for `pnpm test`, `pnpm check`, `db:up` and `app:up`.
  - Never `docker compose down -v` without OK. The bootstrap runs only on an empty volume.
  - P1.2's entry-log table must `REVOKE UPDATE`.
  - pnpm 12 `ERR_PNPM_IGNORED_BUILDS`: decide each package with a reason.
  - TypeScript stays pinned to `~6.0`. New `.ts`/`.tsx` files must be in a tsconfig `include`.
  - `packages/shared` has no Node/DOM globals.
  - Run gitleaks from PowerShell. Test data must not look like personal data.
  - `refs/original/` still holds the pre-rewrite commits (ask before deleting).
  - Don't open AWS before stage 4; ask about placement season first.
  - Answer the Module 00/01 open questions before P1.3/P1.7.
