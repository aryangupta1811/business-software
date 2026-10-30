# Secrets

The repo is public, so anything in git, in a published image, in the browser's JavaScript or in a CI log can be read by anyone. A secret (database password, API key, access token) must never reach any of them. Owner's requirement, session 5: in particular, the Claude API key for the AI assistant must never be readable by GitHub users.

## Where each secret lives

| Where the app runs | Where secrets come from |
| --- | --- |
| This laptop | `.env` in the repo folder (git-ignored). `.env.example` lists the names with fake values. |
| Docker Compose, locally | `.env`, put into each container's environment by `compose.yaml` when it starts |
| AWS (stage 5 onwards) | SSM Parameter Store, encrypted (`SecureString`), read on the server at deploy time (ADR 0011) |
| GitHub Actions | Nothing for AWS: OIDC gives short-lived credentials (ADR 0012). Any other secret goes in GitHub Actions secrets, only if there's no other way. |

Each process gets only what it needs: `migrate` gets `MIGRATION_DATABASE_URL` (owner role), while `api` and `worker` get `DATABASE_URL` (runtime role) (ADR 0021).

## The five ways a secret leaks, and the rule for each

1. **Git.**
   - `.gitignore` blocks `.env*`, keys and Terraform state.
   - Before every commit: a gitleaks scan of staged changes and a personal-data search (`git-workflow.md`, Secrets).
   - GitHub push protection rejects pushes that contain known token formats. From P0.6, gitleaks also runs in CI.
2. **Docker images.** Anyone who can pull an image can read every layer, including files deleted in a later layer and every `ENV`/`ARG` value (`docker history`).
   - Secrets are never copied in (`.dockerignore` excludes `.env*`) and never passed as build arguments.
   - They arrive as environment variables when the container starts.
   - Checked in P0.4: no `.env` in the image, and no secret in its environment or history.
3. **The browser.** Vite copies every `VITE_*` variable into the JavaScript it serves, and anyone can read that in DevTools.
   - Never give a secret a `VITE_` name.
   - The browser never calls a paid or secret-protected API directly. It calls our API, which holds the key.
4. **CI.**
   - GitHub doesn't give secrets to workflows triggered by pull requests from forks. Keep it that way: never use `pull_request_target` with a checkout of the PR's code. That combination runs a stranger's code with our secrets.
   - Never `echo` a secret. GitHub masks known secrets in logs, but not values derived from them.
5. **Logs and error messages.**
   - Config errors name the variable, never its value (`DATABASE_URL is not set`).
   - Log errors with `describeError(error)` (messages only), never the error object. pg-pool attaches the client to idle-connection errors. Its password is a hidden property, so default printing doesn't show it, but serializers that read hidden properties do (`%o`, `showHidden`, test-runner serializers, some error reporters).
   - Drizzle's failed-query messages end with the query's values (`params: …`), which will be customers' data. `describeError` cuts them off.
   - Every entry point runs inside `runProcess()`, so even a crash at startup is logged this way.

## The Claude API key (Phase 3)

- Created by the owner in the Claude Console, with a **spend limit** set there. Even if the key leaked, it couldn't cost more than that limit. The app also enforces its own monthly cap per business (ADR 0015).
- Lives in `.env` locally and in SSM on AWS. Only the `api` process reads it, as `ANTHROPIC_API_KEY`. Never a `VITE_` variable, never in the image, never logged.
- Use a separate key for local development and for the demo server, so one can be revoked without breaking the other.

## If a secret leaks

**Revoke it first:** create a new one and delete the old one at the provider (Claude Console, AWS, Meta, or `ALTER ROLE … PASSWORD` for a database role). Then remove it from the code. Deleting the commit isn't enough: clones, forks, caches and GitHub keep copies. Record what happened in the interview log.
