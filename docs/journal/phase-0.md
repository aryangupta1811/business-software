# Phase 0 — Foundations

In progress. The detailed diary is `INTERVIEW_LOG.md`.

## What we built

- **2026-10-29 (planning chat):** requirements for all modules, with Modules 00 and 01 decided, stored as files in git.
- **2026-10-29 (kickoff session):** confirmed non-functional requirements with measurable targets (RPO 5 min, RTO 1 hour, bill save < 1 s); answered the six architecture questions; chose the stack (16 ADRs); wrote `docs/architecture.md`; split Phases 0–3 into one-session tasks; started the interview log.
- **2026-10-30 (P0.1 Git workflow, DevOps stage 1):** scanned all git history for secrets (gitleaks in Docker) and personal data, then made the repo public; protected `main` with a ruleset nobody can bypass; squash merge only; Conventional Commits; PR template; LF line endings via `.gitattributes`; secret scanning, push protection and Dependabot alerts; commits use the GitHub noreply email. Every setting checked through the GitHub API.
- **2026-10-30 (P0.2 monorepo scaffold):** pnpm workspace with strict TypeScript, ESLint (type-aware) + Prettier, Vitest; `pnpm check` runs everything. First shared code: `parseRupees` and `formatPaise`, written test-first (45 tests, floating-point traps included). Each check proven to fail on a planted error; a fresh reviewer then tried about 60 hostile inputs and found no wrong amount.
- **2026-10-30 (P0.3 database + Docker Compose, DevOps stage 2):** PostgreSQL 18 in Docker Compose (localhost-only port, named volume proven to survive `compose down`, required-password guards). Two roles from a bootstrap file: `app_owner` for migrations, `app_runtime` for the app. The first Drizzle migration sets default privileges, so every future table gives the app select/insert/update and never delete. 8 integration tests on a throwaway PostgreSQL (Testcontainers) prove delete, truncate, create, drop and reading migration history are refused, and a planted `DELETE` grant is caught.
- *Still to do in this phase:* API and web skeletons (the rest of stage 2: app containers), CI, design system.

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
| Code quality & dependencies | ESLint (type-aware) + Prettier, pnpm catalog, lockfile + blocked install scripts + 1-day release age | Biome, no linter; per-package versions | 0018 |
| Database roles & local DB | Bootstrap file + default privileges; `pg`; Drizzle 0.45; Debian `postgres:18` in Compose | Roles in migrations or Terraform; per-table grants; postgres.js; Drizzle 1.0-rc; Alpine | 0019 |

## Mistakes and what I learned

- **Assumed a budget I didn't have.** The first hosting plan assumed ₹1,000/month. With ₹0 and the AWS Free plan ($200 credits, 6 months, account closes after), it would have run out in about 4 months. Redesigned around one EC2 server + RDS, keeping point-in-time restore. Lesson: pin down the real constraint before designing.
- **App and API on different domains would have broken login.** Session cookies aren't sent cross-site. Fixed by serving both from one domain through Caddy. Lesson: auth choices shape hosting.
- **A Claude subscription is not an API key.** The app needs a separate, pay-as-you-go Claude Console key.
- **The repo started inside OneDrive,** which can corrupt `.git`. Moved it out in P0.0.
- **Assumed settings were done; the API said otherwise.** After the GitHub settings, reading them through the API showed secret scanning was still off. Lesson: verify configuration from the source of truth, not from memory or a screenshot.
- **A check that never fails proves nothing.** The first personal-data search found nothing because its pattern got mangled on the way to `git grep`; only testing it against a known example exposed that. Lesson: make a check catch something before trusting it.
- **Installed "latest" TypeScript and broke the linter's peer range.** TypeScript 7 isn't supported by typescript-eslint yet; pinned `~6.0`. Lesson: read peer-dependency warnings.
- **My plan claimed Node could run `shared` from source. It can't.** The tests passed only because Vite resolves `./money.js` to `money.ts`. A fresh reviewer caught it; P0.4 now plans a compile step. Lesson: "works in the test runner" isn't "works in production".
- **Tutorials would have put my database files in the wrong place.** The Postgres 18 image moved its data folder; the usual `/var/lib/postgresql/data` mount would have left data in a volume a teardown can lose. Lesson: check the image's release notes on a major version, then verify with a restart.
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
- Q: How do you avoid floating-point errors with money input?
  A: Never multiply the decimal (`0.29 * 100` is `28.999…`): split the text at the dot, do integer maths, and refuse anything ambiguous. (ADR 0008)
- Q: How do you protect against malicious npm packages?
  A: A committed lockfile, install scripts blocked by default, a one-day wait on new releases, Dependabot alerts. (ADR 0018)
- Q: How do you keep secrets and personal data out of a public repo?
  A: `.gitignore` and environment variables; a gitleaks scan plus a personal-data search before each commit; GitHub push protection at push time; gitleaks in CI. I scanned the full history before going public. If a secret leaks, revoke it first. (ADR 0017)

**DevOps stage 2 (containers), first half:**

- Q: Image vs container vs volume?
  A: An image is the read-only recipe, a container is a disposable running copy, and a volume holds data outside the container so it survives. `compose down` keeps volumes; `down -v` deletes them. (ADR 0019)
- Q: How does your app avoid starting before the database is ready?
  A: A healthcheck plus `docker compose up --wait`. The healthcheck uses TCP, because during first-start init the image's temporary server only listens on a socket and would look ready too early.
- Q: How is your local database secured?
  A: Port bound to `127.0.0.1`, passwords only in a git-ignored `.env`, Compose refuses to start without them, and the app's role can't delete or change the schema.
- Q: How do your tests get a database?
  A: Testcontainers starts a throwaway PostgreSQL with the same image as `compose.yaml` (the test reads it from there), runs the same bootstrap and migrations, then tests real permissions. (ADR 0013)
