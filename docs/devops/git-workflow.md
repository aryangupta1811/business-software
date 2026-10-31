# Git workflow

How a change gets from my laptop to `main`. DevOps stage 1. The reasons for each choice are in ADR 0017.

## Every task, step by step

One session = one task = one branch = one pull request.

```bash
git switch main && git pull           # start from the latest main
git switch -c feat/p1.7-items         # one branch per task
# ...work; commit after each working step...
git push -u origin HEAD               # first push of the branch
gh pr create --web                    # opens the PR form with the template loaded
```

In the form, give the PR a Conventional Commit title (it becomes the commit on `main`) and fill in the template. Don't use `gh pr create --fill`: with more than one commit it titles the PR with the branch name and skips the template.

On GitHub: wait for the five CI checks to pass (see CI below), read the diff once more, then **Squash and merge**. GitHub deletes the branch on the server. Then, locally:

```bash
git switch main && git pull
git branch -D feat/p1.7-items         # -D, not -d: after a squash merge, git can't tell the branch was merged
```

## CI: what runs on a pull request

GitHub Actions runs five checks on a clean Linux machine (ADR 0024). All five are required: the merge button stays grey until they pass.

| Check | What fails it | Reproduce on the laptop |
| --- | --- | --- |
| `check` | Formatting, lint, a type error, a failing test, a broken build, a workflow mistake | `pnpm check && pnpm build` |
| `secrets` | gitleaks finds something that looks like a key anywhere in the history | The full-history gitleaks command below |
| `migrations` | A new migration is older than the newest one on `main`, or the PR removes, re-dates or edits a migration `main` already has | `node packages/db/scripts/check-migration-order.ts origin/main` |
| `smoke` | The real images don't start, a header is wrong, or a container doesn't stop cleanly | `pnpm app:up`, then `scripts/ci/smoke.sh` in Git Bash |
| `pr-title` | The title isn't a Conventional Commit (below) | `PR_TITLE='ci: add x' scripts/ci/check-pr-title.sh` |

When a check fails: on the PR, click **Details** next to it, open the red step and read its last lines. The smoke job prints every container's logs on failure or timeout. Fix it, commit and push; CI runs again by itself. For a bad title, just rename the PR. GitHub's *Revert* button makes a title like `Revert "…"`, which fails: rename it (`fix: revert the stock rounding change`). Dependabot's titles may be longer than 72 characters; the check allows that for Dependabot only.

**When `secrets` is red:** it scans the history of every branch, so the finding may come from another branch or an old commit, and it fails every PR until handled.
1. A real secret: revoke it at the provider first (see Secrets below), then remove it from the code.
2. A test value or false positive: add the finding's `Fingerprint` line (printed in the job log) to `.gitleaksignore` in a PR, with a comment saying why. It's reviewed like code.
3. A leftover throwaway branch: delete it on GitHub.

Never rewrite history to hide it without the owner's OK (`CLAUDE.md` rule 6): clones and forks keep copies anyway.

## Branch names

`type/short-name`, with the task ID when there is one: `feat/p1.7-items`, `fix/udhaar-rounding`, `docs/finalize-module-02`, `chore/p0.1-git-workflow`. Types are the same as in commit messages.

## Commit messages: Conventional Commits

```
type(scope): what changed, in the imperative

Why it changed, if that isn't obvious. Wrap lines at 72 characters.
```

- Summary: lowercase, imperative ("add", not "added"), no full stop, at most 72 characters.
- Scope is optional: the module or area, e.g. `items`, `billing`, `gst`, `udhaar`, `staff`, `db`, `web`, `api`, `infra`.
- A breaking change gets `!` after the type: `feat(api)!: rename bill status values`.
- No AI attribution lines (`CLAUDE.md` rule 6).

| Type | Use for |
| --- | --- |
| `feat` | A new feature for the user |
| `fix` | A bug fix |
| `docs` | Documentation only |
| `test` | Adding or fixing tests only |
| `refactor` | A code change that neither adds a feature nor fixes a bug |
| `perf` | Faster, same behaviour |
| `build` | Build setup, dependencies, Dockerfiles |
| `ci` | GitHub Actions workflows |
| `chore` | Anything else that doesn't change the app (config, tooling) |

Examples: `feat(billing): save bill and stock movements in one transaction`, `fix(gst): round CGST and SGST separately`, `docs: record ADR 0017 git workflow`.

With squash merges, the **pull request title** becomes the commit on `main`, so it follows this format too. The `pr-title` check enforces it (`scripts/ci/check-pr-title.sh`), and re-runs when you rename the PR.

## Pull requests with a migration

Drizzle 0.x silently skips a migration that is older than the newest one already applied (ADR 0021). Before merging a PR that adds a migration, rebase it on `main`. If `main` gained a newer migration meanwhile, delete yours (the `.sql` file and its journal and snapshot entries) and run `pnpm db:generate` again, so yours is the newest.

## Protected `main`

A repository ruleset on `main`: pull request required, no force pushes, no deletion, linear history, no bypass for anyone. Required approvals are 0 because GitHub doesn't let you approve your own pull request. Since P0.6, the five CI checks are required status checks (ADR 0024).

## Secrets

Where secrets live and the rules for images, the browser, CI and logs: `secrets.md`. This section covers git.

- Never commit secrets. `.gitignore` blocks `.env*` (except `.env.example`), `*.pem`, `*.key`, `*.tfvars` and Terraform state. Real values come from environment variables; `.env.example` lists the names with fake values.
- GitHub secret scanning with push protection rejects a `git push` that contains a known token format (AWS, Anthropic, GitHub…).
- gitleaks, run in Docker so nothing gets installed (PowerShell, from the repo folder, with Docker Desktop running):
  ```powershell
  # Before each commit: only the staged changes
  docker run --rm -v "${PWD}:/repo:ro" ghcr.io/gitleaks/gitleaks:v8.30.1 git /repo --pre-commit --staged --redact -v
  # Whole history, every branch
  docker run --rm -v "${PWD}:/repo:ro" ghcr.io/gitleaks/gitleaks:v8.30.1 git /repo --log-opts="--all" --redact -v
  ```
  Last full run on 2026-10-30, before making the repo public: 5 commits, no leaks. Since P0.6 the `secrets` CI job runs the full-history scan on every PR and push to `main`.
- gitleaks looks for secrets, not personal data. Before each commit, also search the staged files for emails, phone numbers, Aadhaar/PAN/GSTIN numbers and home-folder paths (Git Bash):
  ```bash
  git grep -n -I --cached -E '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|(\+91[ -]?)?\b[6-9][0-9]{9}\b|\b[0-9]{4} ?[0-9]{4} ?[0-9]{4}\b|\b[A-Z]{5}[0-9]{4}[A-Z]\b|C:\\Users'
  ```
  Expected hits: the GitHub noreply address (public by design). Demo data must use made-up values (ADR 0016).
- **If a secret is ever committed, revoke it first** (create a new key, delete the old one at the provider), then remove it from the code. Deleting the commit isn't enough: clones, forks and GitHub keep copies.

## Commit email

Commits use the GitHub noreply address, so the personal email isn't published. This repo's setting (since 2026-10-30):

```bash
git config user.email "144018864+aryangupta1811@users.noreply.github.com"
```

Add `--global` to use it in every repo on this laptop.

## Line endings

`.gitattributes` forces LF in the repo and in the working folder, overriding Windows Git's `core.autocrlf=true`. Check any file with `git ls-files --eol`.

## One-time GitHub settings

Done by the owner once, in this order, on 2026-10-30.

1. **Hide the email:** github.com/settings/emails → tick *Keep my email addresses private* and *Block command line pushes that expose my email*.
2. **Make the repo public:** repo → Settings → General → *Danger Zone* → *Change repository visibility* → public.
3. **Merge buttons:** Settings → General → *Pull Requests*: untick *Allow merge commits* and *Allow rebase merging*; keep *Allow squash merging* with default message *Pull request title and commit details*; tick *Automatically delete head branches*.
4. **Protect `main`:** Settings → Rules → Rulesets → *New ruleset* → *New branch ruleset*.
   - Name `protect-main`, Enforcement status *Active*, Bypass list empty.
   - Target branches → *Add target* → *Include default branch*.
   - Tick *Restrict deletions*, *Require linear history*, *Require a pull request before merging* (Required approvals 0; Allowed merge methods: Squash only) and *Block force pushes*. *Require status checks to pass* was added in P0.6 (step 7).
5. **Secret scanning:** Settings → *Advanced Security* (*Code security* on older pages): turn on *Secret scanning* with *Push protection*, and *Dependabot alerts*.
6. **GitHub CLI login**, so `gh pr create` works: in a VS Code terminal, run `gh auth login --hostname github.com --git-protocol https --web --clipboard`, press Enter, paste the one-time code (now on the clipboard) into the page that opens, and authorize. The code is printed in the terminal, never sent to the phone. Check with `gh auth status`.
7. **Require CI** (P0.6, after the checks had run once, so GitHub knew their names): Settings → Rules → Rulesets → `protect-main` → tick *Require status checks to pass*.
   - Tick *Require branches to be up to date before merging*. Otherwise a PR's `migrations` check could have passed against an older `main` (ADR 0024).
   - *Add checks*: `check`, `secrets`, `migrations`, `smoke`, `pr-title`, each with source *GitHub Actions*, so no other app can report them green.
   - *Save changes*. Done with `gh api --method PUT .../rulesets/<id>` on 2026-10-31; the JSON sent was the existing ruleset plus one `required_status_checks` rule.
8. **Actions settings** (defaults, checked 2026-10-31): Settings → Actions → General → *Workflow permissions* stays *Read repository contents*; fork pull requests from first-time contributors need approval before their workflows run.

Check the settings any time (read-only):

```bash
gh api repos/aryangupta1811/business-software/rules/branches/main --jq '.[].type'   # deletion, non_fast_forward, required_linear_history, pull_request, required_status_checks
gh api repos/aryangupta1811/business-software/rulesets --jq '.[] | {name, enforcement}'
gh api repos/aryangupta1811/business-software --jq '.security_and_analysis'
```

Verified 2026-10-30: `protect-main` active with no bypass (`current_user_can_bypass: never`); squash merge only; head branches auto-deleted; secret scanning, push protection and Dependabot alerts on. Step 5 was switched on with `gh api` instead of the web page. Step 7 verified 2026-10-31: the five checks, bound to GitHub Actions (app id 15368), with branches required to be up to date.
