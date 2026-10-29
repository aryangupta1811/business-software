# Phase 0 — Foundations

In progress. The detailed diary is `INTERVIEW_LOG.md`.

## What we built

- **2026-10-29 (planning chat):** requirements for all modules, with Modules 00 and 01 decided, stored as files in git.
- **2026-10-29 (kickoff session):** confirmed non-functional requirements with measurable targets (RPO 5 min, RTO 1 hour, bill save < 1 s); answered the six architecture questions; chose the stack (16 ADRs); wrote `docs/architecture.md`; split Phases 0–3 into one-session tasks; started the interview log.
- **2026-10-30 (P0.1 Git workflow, DevOps stage 1):** scanned all git history for secrets (gitleaks in Docker) and personal data, then made the repo public; protected `main` with a ruleset nobody can bypass; squash merge only; Conventional Commits; PR template; LF line endings via `.gitattributes`; secret scanning, push protection and Dependabot alerts; commits use the GitHub noreply email. Every setting checked through the GitHub API.
- *Still to do in this phase:* monorepo scaffold, database and Docker Compose, API and web skeletons, CI, design system.

## Stack choices vs alternatives

| Area | Chose | Over | ADR |
| --- | --- | --- | --- |
| Offline | Online-first, offline-ready IDs | Offline sync | 0001 |
| Language | TypeScript everywhere (pnpm monorepo) | Python FastAPI, Java Spring Boot | 0002 |
| Frontend | React + Vite SPA | Next.js, Angular/Vue | 0003 |
| Backend | NestJS modular monolith | Minimal framework, microservices | 0004 |
| Database | PostgreSQL + Drizzle | MySQL, MongoDB; Prisma | 0005 |
| Multi-tenancy | Shared tables + Row-Level Security | Database or schema per business | 0006 |
| Data safety | Enforced in the database | App code only | 0007 |
| Money | Integer paise | Floats, decimal type | 0008 |
| Login | Server sessions + Argon2id | JWT, hosted auth | 0009 |
| Jobs & WhatsApp | pg-boss + outbox + Cloud API test number | Redis/BullMQ, SQS; mock, Twilio | 0010 |
| Hosting | AWS Free plan: one EC2 + RDS, Terraform | ECS + load balancer, single VPS only, PaaS, EKS | 0011 |
| CI/CD | GitHub Actions + OIDC + Systems Manager | Jenkins, CodePipeline | 0012 |
| Testing | Vitest + Testcontainers + Playwright | Mocks / SQLite | 0013 |
| Printing | Browser print CSS + kiosk printing + Chromium PDFs | Local print agent, desktop app; JS PDF libraries | 0014 |
| AI | Claude API through permission-checked tools | Text-to-SQL, reports only | 0015 |
| Demo data | Deterministic seed through services | SQL inserts, random inserts | 0016 |
| Git workflow | GitHub flow, squash merge, Conventional Commits, public repo with a ruleset | Git Flow, direct commits to `main`; merge or rebase merges; private repo until the Student Pack | 0017 |

## Mistakes and what I learned

- **Assumed a budget I didn't have.** The first hosting plan assumed ₹1,000/month. With ₹0 and the AWS Free plan ($200 credits, 6 months, account closes after), it would have run out in about 4 months. Redesigned around one EC2 server + RDS, keeping point-in-time restore. Lesson: pin down the real constraint before designing.
- **App and API on different domains would have broken login.** Session cookies aren't sent cross-site. Fixed by serving both from one domain through Caddy. Lesson: auth choices shape hosting.
- **A Claude subscription is not an API key.** The app needs a separate, pay-as-you-go Claude Console key.
- **The repo started inside OneDrive,** which can corrupt `.git`. Moved it out in P0.0.
- **Assumed settings were done; the API said otherwise.** After the GitHub settings, reading them through the API showed secret scanning was still off. Lesson: verify configuration from the source of truth, not from memory or a screenshot.
- **A check that never fails proves nothing.** The first personal-data search found nothing because its pattern got mangled on the way to `git grep`; only testing it against a known example exposed that. Lesson: make a check catch something before trusting it.
- **Waited for a GitHub login code on my phone.** The device-flow code is printed in the terminal. Lesson: read the tool's output before looking elsewhere.

## Interview questions I can now answer

- Q: Why a modular monolith and not microservices?
  A: A bill must update billing, stock and udhaar in one transaction. A monolith does that with one `BEGIN…COMMIT`; microservices would need sagas. (ADR 0004)
- Q: How do you keep tenants' data apart?
  A: `business_id` on every row plus PostgreSQL Row-Level Security, with the app connected as a role that can't bypass it, and tests that try cross-tenant reads. (ADR 0006)
- Q: How do you guarantee zero data loss?
  A: No `DELETE` permission for the app's database user, an append-only log, one transaction per action, idempotency keys, RDS point-in-time restore (RPO 5 min) and a monthly restore drill. (ADRs 0007, 0011)
- Q: How did you host it with no budget?
  A: AWS Free plan credits, with a design sized to them: one EC2 server running Docker Compose plus RDS, and no load balancer or NAT gateway. It's all Terraform, so scaling up is an infrastructure change. (ADR 0011)
- Q: How does your pipeline deploy without AWS keys?
  A: OIDC gives each GitHub Actions run short-lived credentials, and Systems Manager runs the deploy on the server, so there's no SSH port. (ADR 0012)
- Q: What's your branching strategy?
  A: GitHub flow: a short-lived branch per task, merged into a protected `main` by pull request, squash-merged as one Conventional Commit. Nobody can push to `main` directly, me included. (ADR 0017)
- Q: How do you keep secrets and personal data out of a public repo?
  A: `.gitignore` and environment variables; a gitleaks scan plus a personal-data search before each commit; GitHub push protection at push time; gitleaks in CI. I scanned the full history before going public. If a secret leaks, revoke it first. (ADR 0017)
