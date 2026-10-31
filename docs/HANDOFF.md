# Handoff — latest session

Overwritten at the end of every session. Older handoffs are in git history: `git log -p docs/HANDOFF.md`.

**Session:** 6 — P0.5 web skeleton, 2026-10-30/31

**Done:**
- PR #4 (P0.4) was already squash-merged; no stale remote branches were left.
- **Owner's requirement change:** Hinglish is a third interface language (Module 00 #25, NFR 7, both change logs).
- Plan `docs/plans/2026-10-30-p0.5-web-skeleton.md`, approved and run inline, then one fresh review of the whole branch, whose findings were fixed.
- `apps/web`:
  - Vite 8, React 19.3, strict TS, written by hand;
  - TanStack Router: file-based, `autoCodeSplitting`, `routeTree.gen.ts` committed and ignored by ESLint and Prettier;
  - TanStack Query;
  - Tailwind 4: only `@import 'tailwindcss'`, no tokens.
- **Shell:** `routes/__root.tsx` holds the header, the not-found page and `defaultErrorComponent` (`components/route-error.tsx`).
- `api/health.ts` `fetchReadiness()`:
  - never rejects; returns `connected` | `database-down` | `server-down`;
  - `READINESS_TIMEOUT_MS = 10_000`, which must stay above the API's 5 s `connectionTimeoutMillis` (pinned by a test).
- `components/connection-badge.tsx` polls every 30 s.
- `i18n/index.ts`:
  - `LANGUAGES` (`en`, `hi`, `hi-Latn`), `readSavedLanguage`, `changeLanguage` (`localStorage` key `language` + `<html lang>`);
  - `load: 'currentOnly'`, so Hinglish never falls back to Devanagari;
  - keys typed from `en.json` (`i18next.d.ts`). `components/language-switcher.tsx`.
- **Tests:** Vitest + jsdom + Testing Library. `src/test/setup.ts` does cleanup, stubs `scrollTo` and resets to English. `unstubGlobals` and `restoreMocks` are on.
- **ESLint:**
  - react-hooks, jsx-a11y and react-refresh for `apps/web`. jsx-a11y's peer range stops at ESLint 9, but it was proven to work on 10.
  - react-refresh is off in `src/routes/` (TanStack splits route components itself).
- **Docker:**
  - `apps/web/Dockerfile`: `node:24-slim` build → `caddy:2.11-alpine` as user `web`, with `caddy validate` at build time.
  - `apps/web/Caddyfile`:
    - `@api` (`/api`, `/api/*`) → `api:3000`;
    - `/assets/*` immutable for a year only if the file exists;
    - SPA fallback with `no-cache`;
    - `handle_errors` re-applies the security headers and adds `no-store`;
    - strict CSP; `admin off`.
  - `compose.yaml`: `web` on `127.0.0.1:8080`, no `depends_on`. `.dockerignore` now uses `**/.env*`.
- **API:** `X-Powered-By` disabled (`app.ts`), with a test.
- **Scripts:** root `pnpm dev` runs the API and web together (web on http://127.0.0.1:5173, proxying `/api`).
- **Verified:**
  - curl through Caddy: headers, deep link, missing asset, `/api`, 502 with the API stopped;
  - headless Chrome over CDP: no CSP violations, all three languages, the choice kept after a reload, the badge correct 6 of 6 times with the db stopped and with the API stopped, the error screen with a page chunk removed;
  - no secret strings in `/srv`; `web` stops with exit 0.
- **Docs:**
  - ADR 0023;
  - `architecture.md` (web section, diagram);
  - `local-database.md`, `CLAUDE.md` commands, PROGRESS notes for P0.6 and P0.7;
  - interview log (9 entries, Question bank, Glossary, Numbers, Pitch), phase-0 journal.
- **Tests:** 121 in all: 45 shared, 12 db, 28 api, 36 web.

**Half-done:** branch `chore/p0.5-web-skeleton` (12 commits plus this end-session commit) is committed but **not pushed**, and has no PR yet. The owner hasn't read the Hindi and Hinglish wording yet (`apps/web/src/i18n/locales/hi.json`, `hi-Latn.json`).

**Next step:**
1. Owner: read the Hindi and Hinglish wording, and ask for any changes before merging.
2. Owner: `git push -u origin HEAD`, then `gh pr create --web`.
   - Title: `chore: build the react web skeleton with caddy and three languages (P0.5)`.
   - Fill in the template, with no AI attribution line.
   - Squash-merge (no CI yet), then `git switch main`, `git pull`, `git branch -D chore/p0.5-web-skeleton`.
3. Next session: `/start-session` → **P0.6 CI**. Plan first. PROGRESS lists the notes from P0.4 and P0.5:
   - Linux smoke job: api, worker and web exit codes, plus the Caddy `curl -I` checks;
   - build both images with a layer cache;
   - never `pull_request_target` with PR code.

**Watch out for:**
- **No AI attribution, ever:** no `Co-Authored-By: Claude` and no "Generated with Claude Code" (`CLAUDE.md` rule 6 overrides tool defaults).
- **Never write repo files with PowerShell `Set-Content`/`Add-Content`/`Out-File`.**
  - In 5.1 they add a BOM and CRLF. A BOM in `package.json` broke Vitest with a misleading "Cannot find dependency 'jsdom'".
  - The Write tool keeps a BOM that is already in a file. Strip it with `[IO.File]::WriteAllText(path, text, (New-Object Text.UTF8Encoding $false))`.
- **The CSP allows only our own origin.** Fonts, icons or scripts from a CDN will be blocked: self-host them (P0.7) or change the CSP on purpose.
- **Every new string goes in all three locale files.** The tests fail otherwise. Hinglish must not contain Devanagari.
- **Caddy:**
  - `handle` takes one matcher, so use a named one (`@x path a b`) for several paths;
  - error responses drop headers set earlier (hence `handle_errors`);
  - the Dockerfile's `caddy validate` catches syntax errors at build time.
- **Timeouts:** any caller must wait longer than the call it makes. The web's 10 s readiness timeout depends on `packages/db` `connectionTimeoutMillis` (5 s).
- **The Claude in Chrome extension disconnected this session.** Headless Chrome plus a small CDP script did the job. The script isn't in the repo; Playwright arrives in P1.3.
- **Deferred minors from the final review:**
  - `/favicon.ico` gets the SPA fallback HTML (add an icon in P0.7);
  - an asset URL with a trailing slash gives a 308 carrying the immutable header (harmless);
  - `COPY apps/web` in the Dockerfile means a Caddyfile edit reruns the Vite build (about 0.2 s);
  - no fake-timer test of a hanging fetch;
  - React Query pauses polling in a background tab (documented).
- **Still open from P0.4:**
  - `describeError` gaps: an empty `AggregateError`, a cyclic `cause`, `cause: null`;
  - no query timeout on `/ready`;
  - Node 25+ drops Corepack (note it in ADR 0020 before moving to `node:26-slim`).
- Carried over:
  - Docker Desktop must be running for `pnpm test`, `pnpm check`, `db:up` and `app:up`.
  - Never `docker compose down -v` without OK.
  - The bootstrap runs only on an empty volume.
  - P1.2's entry-log table must `REVOKE UPDATE`.
  - pnpm 12 `ERR_PNPM_IGNORED_BUILDS`: decide each package with a reason. pnpm 12 also prints "Agent skills awaiting approval" for TanStack packages; it was left unapproved.
  - TypeScript stays pinned to `~6.0`.
  - New `.ts`/`.tsx` files must be in a tsconfig `include`.
  - `packages/shared` has no Node/DOM globals.
  - Run gitleaks from PowerShell. The lockfile's only personal-data hit is a public npm author address.
  - Test data must not look like personal data.
  - `refs/original/` still holds the pre-rewrite commits (ask before deleting).
  - Don't open AWS before stage 4; ask about placement season first.
  - Answer the Module 00/01 open questions before P1.3/P1.7.
  - Remove the broken pip `aws` before installing AWS CLI v2.
