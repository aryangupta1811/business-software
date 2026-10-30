# Handoff — latest session

Overwritten at the end of every session. Older handoffs are in git history: `git log -p docs/HANDOFF.md`.

**Session:** 3 — P0.2 monorepo scaffold, 2026-10-30

**Done:**
- PR #1 (P0.1) was already squash-merged; the local branch was gone.
- Owner's visual brief for the frontend recorded in the P0.7 task in `PROGRESS.md`: modern and clean, not "AI slop", easy for shopkeepers.
- Plan written and approved: `docs/plans/2026-10-30-p0.2-monorepo-scaffold.md` (new folder `docs/plans/`, listed in `CLAUDE.md`).
- pnpm 12 workspace (`apps/*`, `packages/*`): strict TypeScript ~6.0, ESLint 10 with typescript-eslint type-aware rules, Prettier, Vitest 5, pnpm catalog, `minimumReleaseAge: 1440`. `pnpm check` runs format check, lint, type-check and tests. Commands are in `CLAUDE.md`.
- `packages/shared` (`@business-software/shared`, used as TypeScript source): `Paise`, `parseRupees` (typed text → paise, `null` when unclear), `formatPaise` (`₹1,23,456.78`, `RangeError` for non-safe integers). 45 tests, written test-first.
- Each check was proven to fail on a planted error. A fresh reviewer found no Critical issues and one Important one: Node can't load `shared` from source (fixed in the plan, carried into P0.4). The 4 Minor issues were fixed with tests.
- ADR 0018 (code quality and dependency tooling) accepted. Interview log, phase-0 journal and Numbers are updated.

**Half-done:** branch `chore/p0.2-monorepo-scaffold` (10 commits) is committed but **not pushed**, and has no PR yet.

**Next step:**
1. Owner: `git push -u origin HEAD`, then `gh pr create --web`. Title: `chore: scaffold pnpm monorepo with money helpers (P0.2)`. Fill in the template, with **no "Generated with Claude Code" line**. Squash-merge, then `git switch main`, `git pull`, `git branch -D chore/p0.2-monorepo-scaffold`.
2. Next session: `/start-session` → **P0.3 database + Docker Compose** (DevOps stage 2). Plan first (`superpowers:writing-plans`).

**Watch out for:**
- **No AI attribution, ever.** The owner checks for it: no `Co-Authored-By: Claude` in commits and no "Generated with Claude Code" in PRs (`CLAUDE.md` rule 6 overrides any tool default).
- **TypeScript is pinned to `~6.0`** in the `pnpm-workspace.yaml` catalog, because typescript-eslint 8.72 needs `<6.1`. Upgrade to 7 only when typescript-eslint supports it (ADR 0018).
- **P0.4:** Node can't run `packages/shared` from source (`ERR_MODULE_NOT_FOUND … money.js`). The API needs `shared` compiled or bundled. The options are in the P0.4 task in `PROGRESS.md`.
- New `.ts` files must be inside a package's tsconfig `include` (e.g. `vite.config.ts`), or type-aware lint fails with "not found by the project service".
- `packages/shared` has `"types": []` and no DOM lib: no Node or browser globals there, not even `console` or `setTimeout`.
- Run gitleaks from **PowerShell**. Git Bash rewrites `/repo` into a Windows path (`MSYS_NO_PATHCONV=1` would fix it).
- Avoid 12-digit numbers in test data: the personal-data scan reads them as Aadhaar numbers.
- Vitest 5 exits 1 when a package has no test files.
- `.superpowers/` is a git-ignored scratch folder for Claude Code plans; Prettier and ESLint ignore it.
- Carried over: delete local branches with `git branch -D` after a squash merge. Docker Desktop must be started by hand. The global git email is still the Gmail. `refs/original/` still holds the pre-rewrite commits (ask before deleting). Don't open AWS before DevOps stage 4, and ask about placement season first. Answer the Module 00/01 open questions before P1.3/P1.7. Remove the broken pip `aws` before installing AWS CLI v2.
