# 0012 — CI/CD: GitHub Actions, logging in to AWS with OIDC

- **Date:** 2026-10-29
- **Status:** Accepted

## Context

`docs/devops/DEVOPS_PLAN.md` stages 1, 3 and 6: protected `main`, every push and PR runs lint, tests and a build, auto-deploy to staging, manual approval to production, one-step rollback, health checks. The repo is a private GitHub repository. Cost must stay near zero.

## Options considered

### Option A — GitHub Actions
- Pros: built into GitHub; free monthly minutes for private repos; nothing to host; huge library of ready actions; supports OIDC login to AWS.
- Cons: tied to GitHub; YAML can get long.

### Option B — Jenkins
- Pros: classic, very flexible, common in older companies.
- Cons: needs its own server, which costs money and must be patched and secured, all before it does anything useful.

### Option C — AWS CodePipeline / CodeBuild
- Pros: native to AWS.
- Cons: AWS-only; less common on CVs; awkward for checks on GitHub pull requests.

## Decision

Option A.

- **CI on every push and pull request:** install → lint → type-check → unit tests → integration tests (a PostgreSQL service container) → build the web app and container image. Security scanning (Trivy, dependency audit) is added in DevOps stage 10.
- **`main` is protected:** changes arrive through pull requests, and CI must be green before merging.
- **CD:** a merge to `main` builds the image and pushes it to the registry. The deploy job then uses AWS Systems Manager to run `docker compose pull && docker compose up -d` on the EC2 server (ADR 0011), so there's no SSH port to open. It waits for the health check, and if that fails it switches back to the previous image tag. Deploys to the demo environment need a manual go-ahead. A staging copy is created from Terraform only to rehearse risky changes.
- **AWS access through OIDC:** GitHub gets short-lived credentials for one narrowly scoped IAM role on each run. No AWS keys are stored in GitHub.
- A CI status badge goes in the README (portfolio output).

## Why

GitHub Actions does everything the plan needs with nothing to host and no cost. OIDC removes the biggest CI security risk, long-lived cloud keys sitting in secrets.

## Consequences

- Workflows live in `.github/workflows/` and are reviewed like code.
- CI must stay fast (target: under 10 minutes), so unit tests stay pure and integration tests share one database container.
- Jenkins can still be explored later as a learning exercise run locally in Docker, without changing the real pipeline.
- GitHub plan limits on **private** repos: branch protection needs GitHub Pro (free with the Student Developer Pack), and required-reviewer approval on deployment environments needs GitHub Enterprise. On a **public** repo both are free. A portfolio repo should be public anyway, after a secrets check. Until then, the demo deploy is started by hand (`workflow_dispatch`), which serves as the manual approval.

## Interview note

My pipeline runs lint, type-checks, unit and real-database integration tests on every PR, and after a merge to protected main it deploys through AWS Systems Manager with a health check and automatic rollback to the previous image. There are no AWS keys in GitHub and no SSH port open: each run uses OIDC to get short-lived credentials for one IAM role. I chose GitHub Actions over Jenkins because Jenkins needs a server I'd have to run, pay for and patch.
