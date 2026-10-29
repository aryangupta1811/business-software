# Handoff — latest session

Overwritten at the end of every session. Older handoffs are in git history: `git log -p docs/HANDOFF.md`.

**Session:** 2 — P0.1 Git workflow, 2026-10-30

**Done:**
- P0.0 laptop setup confirmed by the owner (WSL 2, Docker, pnpm, VS Code extensions; repo now in a `projects` folder outside OneDrive). Student Pack applied, awaiting approval.
- Secrets: gitleaks (in Docker) scanned all history: no leaks. Personal-data search: only the GitHub noreply address.
- **Repo is now public.** `protect-main` ruleset on `main`, squash merge only, branches auto-deleted after merge, secret scanning + push protection + Dependabot alerts on. All checked through the GitHub API.
- ADR 0017 (git workflow) accepted. How-to and settings: `docs/devops/git-workflow.md`. PR template: `.github/pull_request_template.md`. `.gitattributes` forces LF.
- Commits in this repo use `144018864+aryangupta1811@users.noreply.github.com` (local git config). GitHub blocks pushes that expose the personal email.
- `CLAUDE.md`: rule 6 (a branch and PR per task, Conventional Commits) and new rule 11 (public repo: no secrets or personal data). `/start-session` now creates the task branch; `/end-session` scans staged changes before committing.
- `gh` CLI logged in (device flow; the code is printed in the terminal, not sent to the phone).

**Half-done:** branch `chore/p0.1-git-workflow` (3 commits) is committed but not pushed or merged.

**Next step:**
1. Owner: `git push origin HEAD:main` (should be **rejected** with `GH013`, proving protection works) → `git push -u origin HEAD` → `gh pr create --fill` → squash-merge on GitHub → `git switch main`, `git pull`, `git branch -D chore/p0.1-git-workflow`.
2. Next session: `/start-session` → **P0.2 monorepo scaffold**. It's the first code: write a short implementation plan (`superpowers:writing-plans`) and get the owner's OK before writing code (`CLAUDE.md` rule 5).

**Watch out for:**
- `main` can't be pushed to directly any more. Every change, including docs, goes through a branch and a PR.
- After a squash merge, delete the local branch with `git branch -D` (`-d` says "not fully merged").
- The global git email is still the Gmail. With *Block command line pushes that expose my email* on, pushes from **other** repos will fail; fix with `git config --global user.email "144018864+aryangupta1811@users.noreply.github.com"`.
- Docker Desktop doesn't start by itself: start it before `docker` commands (the gitleaks scan needs it).
- Run the personal-data check exactly as written in `git-workflow.md`; passing the pattern through other tools mangled its backslashes once.
- P0.6 must add: CI as a required status check in `protect-main`, a Conventional Commits check on PR titles, and gitleaks in CI.
- `refs/original/refs/heads/main` (local only) still holds the two pre-rewrite commits from 10-29. Harmless; ask before deleting.
- **AWS Free plan clock:** the account closes 6 months after sign-up or when credits run out. Don't open it before DevOps stage 4, and ask when placement season is first (ADR 0011).
- Answer Module 00's open questions (auto-lock time, password reset, deactivation, #18 vs #22) before P1.3–P1.6, and Module 01's before P1.7.
- The `aws` command on PATH (`Python311\Scripts\aws.cmd`) is a broken old pip install. Remove it before installing AWS CLI v2.
- The only cost that can't be zero: a few dollars of Claude API credit in Phase 3 (ADR 0015).
- The owner wants a decisive "best stack" approach, but explanations in simple words (`CLAUDE.md` "About me").
- Update `INTERVIEW_LOG.md` during every session, including small things.
