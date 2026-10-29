# 0017 — Git workflow: GitHub flow, squash merges, Conventional Commits, public repo

- **Date:** 2026-10-30
- **Status:** Accepted

## Context

DevOps stage 1 (`docs/devops/DEVOPS_PLAN.md`): branches, pull requests, a protected `main`, commit conventions, no secrets in git. ADR 0012 already requires that changes reach `main` through pull requests with green CI, and that a merge to `main` deploys.

Constraints:
- One developer, with Claude Code writing much of the code. The pull request is where I read and check every change before it lands.
- The repo was private. Branch protection on a private repo needs GitHub Pro, and my Student Developer Pack application is still pending.
- It's a portfolio project, so recruiters need to read the code and the history.
- Laptop on Windows; containers and CI on Linux.

## Options considered

### Branching model
- **GitHub flow** (chosen): `main` is always deployable; each task gets a short-lived branch merged by pull request. Simple, and fits deploy-on-merge.
- **Git Flow**: `develop`, `release` and `hotfix` branches. Built for software shipped in scheduled versions; for a continuously deployed app it's ceremony with no benefit.
- **Committing straight to `main`**: fastest, but nothing stops a broken change from reaching `main` and the deploy.

### Merge method
- **Squash and merge** (chosen): the whole branch becomes one commit on `main`, titled by the pull request. `main` reads like a changelog, and one `git revert` undoes a whole task. The small commits stay visible in the pull request.
- **Merge commit**: keeps every branch commit plus an extra merge commit; history becomes a tangle of lines.
- **Rebase and merge**: linear, but every work-in-progress commit lands on `main`.

### Commit messages
- **Conventional Commits** (chosen): `type(scope): summary`. An industry standard that's easy to scan and can be checked by a machine (and turned into release notes later).
- **Free-form**: no rules to learn, but history becomes inconsistent ("fix", "wip", "final2").

### Repo visibility
- **Public, after a full-history secrets scan** (chosen): branch protection, secret scanning and push protection are free, and recruiters can see it.
- **Private until the Student Pack arrives**: hides unfinished work, but protection waits on GitHub's approval, and the repo has to go public for placements anyway.

### Protection mechanism
- **Repository ruleset** (chosen): GitHub's newer system; rules can be layered and exported as JSON.
- **Classic branch protection rule**: still works, but GitHub is moving features to rulesets.

## Decision

- **GitHub flow.** One task = one session = one branch = one pull request. Branch names: `type/short-name`, e.g. `feat/p1.7-items`.
- **Squash and merge only.** The pull request title becomes the commit on `main`, with the branch's commit messages kept in its body.
- **Conventional Commits** for every commit and pull request title. CI checks pull request titles from P0.6.
- **Public repo.** Gitleaks scanned all history on 2026-10-30 (5 commits, including two pre-rewrite commits kept locally under `refs/original`): no leaks. No emails or phone numbers in tracked files.
- **A ruleset protects `main`:** pull request required, no force pushes, no deletion, linear history, and nobody can bypass, the admin included. Required approvals: 0, because GitHub doesn't let authors approve their own pull requests. Required status checks are added once CI exists (P0.6).
- **Secrets and personal data:** GitHub secret scanning with push protection; a gitleaks scan of staged changes plus a personal-data search before each session's commit; gitleaks in CI from P0.6; `.gitignore` already blocks `.env*`, keys and Terraform state.
- **Commit email:** the GitHub noreply address (`144018864+aryangupta1811@users.noreply.github.com`), so my personal email isn't published in new commits.
- **Line endings:** `.gitattributes` forces LF everywhere.

How-to and the one-time GitHub settings: `docs/devops/git-workflow.md`.

## Why

GitHub flow + squash merge is the lightest workflow that still gives every change a gate (CI) and a review moment (reading my own diff), and it matches deploy-on-merge from ADR 0012. Going public makes protection free today instead of waiting on the Student Pack, and a portfolio repo has to be public anyway.

## Consequences

- Every change goes through a pull request, including end-of-session doc updates. `/start-session` creates the branch; `/end-session` commits on it; I push and merge.
- After a squash merge, `git branch -d` refuses to delete the local branch ("not fully merged"), because its commits aren't in `main` under the same IDs. Delete it with `git branch -D` once the pull request shows as merged.
- Everything committed is public forever, including requirements, ADRs and journals. Never commit real customer data; demo data is generated (ADR 0016). If a secret leaks, revoke it first, because deleting the commit doesn't remove copies.
- Commits made before 2026-10-30 still show my Gmail. Rewriting them wouldn't remove it, because GitHub keeps old commits reachable by their ID.
- With 0 required approvals, the pull request is a CI gate plus a self-review, not a second person's review. If a collaborator joins, require 1 approval.

## Interview note

I use GitHub flow: every task is a short-lived branch merged into a protected `main` by pull request, and a ruleset blocks direct pushes and force-pushes, even for me. I squash-merge so each pull request is one Conventional Commit on `main`, which keeps history readable and makes reverting a feature one command. Before making the repo public I scanned the full git history with gitleaks, and push protection now blocks known secret formats at `git push`.
