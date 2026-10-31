# 0024 — CI pipeline: five required checks, SHA-pinned actions, no secrets

- **Date:** 2026-10-31
- **Status:** Accepted

## Context

ADR 0012 chose GitHub Actions and sketched the pipeline. P0.6 builds it (`docs/PROGRESS.md`), with the notes from P0.4 and P0.5:
- a Linux smoke test of the real images, because Windows can't send containers real stop signals;
- both images built with a layer cache;
- a check for Drizzle's out-of-order migration trap (ADR 0021);
- a PR-title check, since the squash-merged title becomes the commit on `main` (ADR 0017);
- a secrets scan.

The repo is public, so anyone can open a pull request, and the rules in `docs/devops/secrets.md` (rule 4) apply.

## Options considered

### Integration tests: Testcontainers (chosen) vs a `services: postgres` container
- Testcontainers: the same code path as the laptop (ADR 0013). The test helper reads the PostgreSQL image from `compose.yaml` and runs the same bootstrap roles script. GitHub's Ubuntu runners have Docker, so nothing changes.
- Service container: the database would start before any step runs. But it's set up differently from Compose (no bootstrap script mount), so CI would test a different database from the laptop's. ADR 0012's "PostgreSQL service container" line is refined here.

### PR-title check: a 20-line bash script (chosen) vs a marketplace action
- Script: no third-party code, testable locally, and it shows the script-injection rule (the title goes through `env:`).
- Action (e.g. `amannn/action-semantic-pull-request`): more features, but outside code runs on every PR, and its usual setup uses `pull_request_target`.

### Secrets scan: gitleaks Docker image (chosen) vs `gitleaks-action`
- Docker image: the same tool and version as the local pre-commit command. The image is pinned by digest. No licence key.
- `gitleaks-action`: needs a licence for organisation accounts, and adds another action to trust.

### Building images: `docker/build-push-action` with the GitHub cache (chosen) vs `docker compose up --build`
- build-push-action: `cache-to/cache-from: type=gha`, so a run that changes no dependency reuses the install layers. It tags the images with the names in `compose.yaml`, then Compose starts them with `--no-build`.
- `compose --build`: simpler, but it can't use the GitHub cache, so every run reinstalls every dependency.

### Pinning actions: full commit SHA (chosen) vs a version tag
- SHA: the code can't change under us. The tj-actions/changed-files attack in March 2025 moved tags to malicious code that dumped CI secrets. Dependabot (`.github/dependabot.yml`, monthly, actions only) keeps the pins current.
- Tag: readable, but whoever controls the action's repo can repoint it.

## Decision

Two workflow files, five jobs, all required in the `protect-main` ruleset. Each required check is bound to the GitHub Actions app, so no other integration can report it green. A PR must also be up to date with `main`: otherwise `migrations` could pass against an older `main` and go stale once `main` gains a migration.

| Job | Workflow | What it checks |
| --- | --- | --- |
| `check` | `ci.yml` | Install with the frozen lockfile, format, lint, type-check, all tests (Testcontainers), build, actionlint on the workflows |
| `secrets` | `ci.yml` | gitleaks over the whole git history |
| `migrations` | `ci.yml` (PRs only) | `packages/db/scripts/check-migration-order.ts`: every new migration is newer than every migration on the base branch |
| `smoke` | `ci.yml` | Build both images with the GitHub cache, `docker compose up --wait`, then `scripts/ci/smoke.sh`: readiness direct and through Caddy, Caddy's cache and CSP headers, a 404 for a missing asset, migrate with a wrong password exits 1, api, worker and web exit 0 on `docker compose stop` |
| `pr-title` | `pr-title.yml` | `scripts/ci/check-pr-title.sh`: Conventional Commit format, lowercase, no full stop, at most 72 characters |

Rules for every workflow:
- triggers: `pull_request`, `push` to `main`, `workflow_dispatch`, never `pull_request_target`;
- `permissions: contents: read`;
- `persist-credentials: false` on checkout;
- event values reach scripts only through `env:`;
- `timeout-minutes` on every job;
- `concurrency` cancels a PR's older run;
- CI uses no repository secrets at all.

`pr-title` is its own workflow because it must also run when the PR is renamed (`edited`). In `ci.yml`, a rename would either re-run everything or cancel a running build, leaving a required check skipped.

## Why

The pipeline checks what production runs: the real images, started the real way. CI catches anything that only works on Windows. Each check that's more than a line lives in a script the owner can run locally, so a red CI run can be reproduced on the laptop. Pinning, read-only permissions and having no secrets limit what a hijacked dependency or a malicious PR could do.

## Consequences

- A PR can't merge until all five checks pass. A push to `main` runs `check`, `secrets` and `smoke`; `migrations` and `pr-title` only run on PRs.
- Action updates arrive as one Dependabot PR a month, which must pass CI like any other.
- When `main` moves, an open PR needs *Update branch* and a fresh run before it can merge.
- Measured on PR #6: `smoke` takes 2 min 47 s with an empty cache and 50 s with a warm one. GitHub scopes the cache by branch: a run reads its own branch's cache and `main`'s. A branch with neither paid 73 s to export the cache, which only saves a 6 s install. Most of the win comes from skipping the TypeScript and Vite builds. The cache holds up to 10 GB per repo and evicts old entries.
- `ADR 0012`'s CD part (image push, deploy through SSM with OIDC) is still to come in stage 6. It will need a separate workflow with `id-token: write`, never added to `ci.yml`.
- Stage 10 adds Trivy image scans and a dependency audit.

## Interview note

Every PR runs five required checks on a clean Linux machine: lint, types and tests against a real PostgreSQL; a gitleaks scan; a check that stops the Drizzle migration-ordering trap; a PR-title check; and a smoke test that builds the real images with a layer cache, starts them with Compose and checks headers, failures and clean shutdowns. The workflows have read-only permissions, use no secrets, and pin every action to a commit SHA, because the 2025 tj-actions attack showed tags can be repointed. Anything more than one line is a script I can run on my laptop, so a red build is reproducible.
