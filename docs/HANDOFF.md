# Handoff — latest session

Overwritten at the end of every session. Older handoffs are in git history: `git log -p docs/HANDOFF.md`.

**Session:** 7 — P0.6 CI, 2026-10-31

**Done:**
- PR #5 (P0.5) was already squash-merged; `main` was clean.
- Plan `docs/plans/2026-10-31-p0.6-ci.md`. The owner said "find best fit and go":
  - Claude pushed the branch and opened PR #6;
  - Claude set the required checks with `gh api`;
  - the plan was run inline, then one fresh review of the whole branch.
- **Workflows:**
  - `.github/workflows/ci.yml` has four jobs:
    - `check`: format, lint, types, all tests with Testcontainers, build, actionlint;
    - `secrets`: gitleaks v8.30.1 over the whole history;
    - `migrations`: PRs only;
    - `smoke`: builds both images with `docker/build-push-action` and the `gha` cache, runs `docker compose up -d --wait --wait-timeout 180 --no-build`, then `scripts/ci/smoke.sh`; prints container logs on failure or timeout.
  - `.github/workflows/pr-title.yml` runs `scripts/ci/check-pr-title.sh`, with the title and author passed through `env:`. The 72-character limit is waived for `dependabot[bot]`.
  - `.github/dependabot.yml`: GitHub Actions only, monthly, grouped, prefix `ci`.
- **Rules in every workflow:**
  - actions pinned to SHAs; the gitleaks and actionlint images pinned by digest;
  - `permissions: contents: read`, `persist-credentials: false`;
  - no secrets, never `pull_request_target`;
  - a timeout on every job; `concurrency` cancels a PR's older run.
- **`packages/db/scripts/check-migration-order.ts`:**
  - Runs with plain Node (type stripping, no build); `scripts` is in `packages/db/tsconfig.json`, not in the build.
  - `findOutOfOrderMigrations` and `findChangedMigrations`, with 9 tests.
  - The CLI also fails on an edited or deleted `.sql` file (diffed against the merge base), and on an unreadable base journal.
  - Exit codes: 0 OK, 1 problem, 2 unknown ref or no argument.
- **`scripts/ci/smoke.sh`:** 7 checks:
  - readiness, direct and through Caddy;
  - `/` is `no-cache` with the CSP;
  - a deep link gets 200;
  - a missing asset is 404 `no-store`;
  - migrate with a wrong password exits 1;
  - api, worker and web exit 0 on `docker compose stop`.
- **`protect-main` ruleset:**
  - five required checks: `check`, `secrets`, `migrations`, `smoke`, `pr-title`;
  - each bound to GitHub Actions (app id 15368);
  - branches must be up to date with `main`.
  - Verified with `gh api`. The click path is in `git-workflow.md`, step 7.
- **Proof:**
  - green on the first run;
  - each check made to fail once on purpose: `check`, `secrets` and `smoke` on a throwaway branch run with `gh workflow run`, then deleted; `pr-title` by renaming PR #6.
  - Cache: `smoke` takes 2 min 47 s cold and 50 s warm. A branch with no cache of its own and none on `main` paid 73 s to export it.
- **Final review:** no critical or important findings. Fixed: Dependabot titles, changed migrations, the fail-open journal read, no logs on a timeout, two false doc claims. Added a "red `secrets`" runbook.
- **Docs:**
  - ADR 0024 and its line in the ADR index;
  - `README.md` with the CI badge;
  - `architecture.md`, `git-workflow.md` (CI section, steps 7 and 8, gitleaks v8.30.1), `secrets.md`, `CLAUDE.md` (CI line), PROGRESS (P0.6 ticked, a P1.3 Playwright note);
  - the interview log (10 entries, Question bank, Glossary, Numbers) and the phase-0 journal.
- **Tests:** 130 in all: 45 shared, 21 db, 28 api, 36 web.

**Half-done:** PR #6 (`ci/p0.6-ci`) is open, green and mergeable. This end-session commit is local, not pushed.

**Next step:**
1. Owner: `git push`. Wait for the five checks, then squash-merge PR #6, keeping the title `ci: add github actions ci with smoke tests and required checks (P0.6)`.
2. Then `git switch main`, `git pull`, `git branch -D ci/p0.6-ci`. The merge's CI run on `main` fills the cache that new PRs read.
3. Next session: `/start-session` → **P0.7 design system**. First ask the owner for colours, apps whose look they like, and light or dark (PROGRESS has the P0.5 notes: self-host fonts, Devanagari, shadcn/ui, favicon).

**Watch out for:**
- **No AI attribution, ever:** no `Co-Authored-By: Claude` and no "Generated with Claude Code" (`CLAUDE.md` rule 6 overrides tool defaults).
- **CI is now the gate.** All five checks are required, and a PR must be up to date with `main`; after another merge, click *Update branch*.
  - PR titles: lowercase Conventional Commit, at most 72 characters, no full stop.
  - GitHub's *Revert* button title fails: rename it to e.g. `fix: revert …`.
  - Editing a PR's description re-runs `pr-title` (5 s).
- **Migrations:** never edit, re-date or delete one that's on `main`, because CI fails it. Add a new one instead. A new one must be newer than `main`'s (rebase, then regenerate).
- **A red `secrets` check fails every PR,** because it scans every branch.
  - Revoke a real key first.
  - For a false positive, add its fingerprint to `.gitleaksignore` in a PR.
  - Never commit a fake secret to a real branch; use a throwaway branch and delete it.
- **Pinned versions:** Dependabot updates only `uses:` actions. The gitleaks image (CI digest plus the local command in `git-workflow.md`) and the actionlint image are bumped by hand. CI and local must use the same gitleaks version.
- **New workflow rules:**
  - pin new actions to a SHA with a `# vX.Y.Z` comment;
  - any `${{ github.event.* }}` value goes through `env:`, never inside `run:`;
  - run actionlint locally: `docker run --rm -v "${PWD}:/repo:ro" -w /repo rhysd/actionlint:1.7.12` (PowerShell).
- **Cache:** GitHub scopes it by branch (own branch plus `main`). Don't judge cache speed on a fresh branch.
- **Never write repo files with PowerShell `Set-Content`/`Add-Content`/`Out-File`** (BOM and CRLF). Strip a BOM with `[IO.File]::WriteAllText(path, text, (New-Object Text.UTF8Encoding $false))`. Inline Python heredocs in Git Bash can mangle quotes and `\n`: write the script to the scratchpad and run it from there.
- **The CSP allows only our own origin:** self-host fonts and icons in P0.7.
- **Every new string goes in all three locale files.** Hinglish must not contain Devanagari.
- **Deferred minors:**
  - From P0.6:
    - the "reproduce `check`" row in `git-workflow.md` lacks the actionlint command;
    - the repo setting *Require actions to be pinned to a full-length commit SHA* is off. The owner decides; it's a settings change.
  - From P0.5: `/favicon.ico` gets the SPA HTML (P0.7); an asset URL with a trailing slash gets a 308 with the immutable header; a Caddyfile edit reruns the Vite build; no fake-timer test of a hanging fetch; polling pauses in background tabs.
  - From P0.4: `describeError` gaps (an empty `AggregateError`, a cyclic `cause`, `cause: null`); no query timeout on `/ready`; Node 25+ drops Corepack (note it in ADR 0020 before `node:26-slim`).
- **Carried over:**
  - Docker Desktop must be running for `pnpm test`, `pnpm check`, `db:up` and `app:up`.
  - Never `docker compose down -v` without OK. The bootstrap runs only on an empty volume.
  - P1.2's entry-log table must `REVOKE UPDATE`.
  - pnpm 12 `ERR_PNPM_IGNORED_BUILDS`: decide each package with a reason. pnpm's TanStack "Agent skills awaiting approval" note is expected; it also shows in CI.
  - TypeScript stays pinned to `~6.0`. New `.ts`/`.tsx` files must be in a tsconfig `include`.
  - `packages/shared` has no Node/DOM globals.
  - Run gitleaks from PowerShell. Test data must not look like personal data.
  - `refs/original/` still holds the pre-rewrite commits (ask before deleting).
  - Don't open AWS before stage 4; ask about placement season first. Remove the broken pip `aws` before installing AWS CLI v2.
  - Answer the Module 00/01 open questions before P1.3/P1.7.
