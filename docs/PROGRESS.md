# Progress

**Current focus:** Phase 0 — foundations (API skeleton done; web skeleton next)
**Next step:** Owner pushes and merges the P0.4 pull request; next session: P0.5 web skeleton (plan first)
**Last updated:** 2026-10-30

Each task below is sized for **one session**. DevOps stages (from `docs/devops/DEVOPS_PLAN.md`) are woven in where they're first needed. Tasks for DRAFT modules are provisional: re-cut them after `/finalize-module NN`.

## Requirements status

| Module | Status |
| --- | --- |
| Product overview | DECIDED (NFRs confirmed, architecture questions answered 2026-10-29) |
| 00 Business setup, users & roles | DECIDED (open questions remain) |
| 01 Items & inventory | DECIDED (open questions remain) |
| 02 Billing & GST | DRAFT |
| 03 Udhaar | DRAFT |
| 04 Suppliers & purchases | DRAFT |
| 05 Staff, attendance & salary | DRAFT |
| 06 Entry logs | DRAFT |
| 07 Alerts | DRAFT |
| 08 Dashboard | DRAFT |
| 09 AI assistant | DRAFT |

## Phase 0 — Foundations

- [x] Requirements for Modules 00 and 01 decided (planning chat, 2026-10-29)
- [x] Confirm the non-functional requirements in `product-overview.md` (2026-10-29)
- [x] Answer the open architecture questions in `product-overview.md` (2026-10-29)
- [x] Choose the tech stack — ADRs 0001–0016 (2026-10-29)
- [x] Write `docs/architecture.md` with diagrams (2026-10-29)
- [x] Break Phases 1–3 into one-session tasks (2026-10-29)
- [x] Start `docs/journal/INTERVIEW_LOG.md` (2026-10-29)
- [x] **P0.0 Laptop setup** (owner, done 2026-10-30; Student Pack applied, awaiting approval): move the repo out of OneDrive; `wsl --install` in an admin PowerShell, then restart; Docker Desktop (WSL 2 backend), checked with `docker run hello-world`; pnpm (`npm install -g pnpm`); VS Code extensions (ESLint, Prettier, Tailwind CSS IntelliSense, Docker); apply for the GitHub Student Developer Pack. Already installed (checked 2026-10-29): Git 2.56, GitHub CLI 2.103, Node 24.18 (LTS), VS Code; 24 GB RAM, 49 GB free on C:. **Later, at DevOps stage 4:** AWS CLI v2 (the existing `aws` in `Python311\Scripts` is a broken old pip install, so remove it) and Terraform.
- [x] **P0.1 Git workflow** (DevOps stage 1, done 2026-10-30, ADR 0017): `.gitattributes` forcing LF; PR template; GitHub flow + Conventional Commits in `docs/devops/git-workflow.md`; full-history gitleaks scan (no leaks) and a personal-data check, then the repo was made **public**; `protect-main` ruleset (PR required, squash only, no force-push or deletion, no bypass); secret scanning, push protection and Dependabot alerts on; commits use the GitHub noreply email; `gh` logged in. Verified through the GitHub API.
- [x] **P0.2 Monorepo scaffold** (done 2026-10-30, ADR 0018, plan `docs/plans/2026-10-30-p0.2-monorepo-scaffold.md`): pnpm 12 workspace (`apps/*`, `packages/*`), strict TypeScript ~6.0 (typescript-eslint doesn't support 7 yet), ESLint with type-aware rules + Prettier, Vitest 5, pnpm catalog, one-day `minimumReleaseAge`; `packages/shared` with `parseRupees` and `formatPaise`, test-first (45 tests); every check proven to fail on a planted error; commands in `CLAUDE.md`. `apps/web` and `apps/api` were deliberately left to P0.5/P0.4, which generate them with Vite and NestJS tools.
- [x] **P0.3 Database + Docker Compose** (DevOps stage 2, first half; done 2026-10-30, ADR 0019, plan `docs/plans/2026-10-30-p0.3-database-compose.md`): PostgreSQL 18 in Docker Compose (`pnpm db:up`), roles `app_owner`/`app_runtime` from `packages/db/bootstrap/create-roles.sql`, Drizzle 0.45 with migration `0000` (default privileges: select/insert/update, never delete), `pnpm db:migrate`; 9 Testcontainers integration tests; runbook `docs/devops/local-database.md`. A fresh reviewer found no bugs.
- [x] **P0.4 API skeleton** (DevOps stage 2, second half; done 2026-10-30, ADRs 0020–0022, plan `docs/plans/2026-10-30-p0.4-api-skeleton.md`): NestJS 12 (ESM, Express) in `apps/api` with `/api/health` (liveness) and `/api/health/ready` (readiness, 503 without the database); three entry points from one image: `main.js` (api), `worker.js`, `migrate.js` (one-shot, as `app_owner`, before api and worker); `createDatabase`/`runMigrations` in `packages/db`; packages compile with TypeScript project references, and a `source` export condition lets tests and lint skip the build; multi-stage non-root `node:24-slim` image (375 MB, app 40 MB); `pnpm dev`, `pnpm build`, `pnpm app:up`; secrets rules in `docs/devops/secrets.md` (owner's request about the AI key); 84 tests. Docker runs found two bugs: the worker exited after pg's 10 s idle timeout, and the API exited 143 instead of 0. The final review found more: entry-point crashes skipped messages-only logging, the worker crash-looped without a database, Drizzle `params:` reached the logs, the API listened on every interface, and a doc stated a wrong pg fact. All fixed. Deferred minors are in `HANDOFF.md`.
- [ ] **P0.5 Web skeleton:** React + Vite app shell calling the API; English/Hindi switch with i18next; `docker compose up` starts everything. **From P0.4:** no secret in any `VITE_` variable (Vite puts them in the browser's JavaScript; `docs/devops/secrets.md`). The API image and Compose services already exist (ADR 0020); add the web app's build and serving next to them.
- [ ] **P0.6 CI** (DevOps stage 3): GitHub Actions running lint, type-check, unit and integration tests, and builds on every push/PR; a Conventional Commits check on PR titles; a gitleaks secrets scan; then make CI a required status check in the `protect-main` ruleset (ADR 0017); status badge in a new README. **From P0.4:** never `pull_request_target` with a checkout of PR code, and fork PRs get no secrets (`docs/devops/secrets.md`); build the Docker image in CI with a layer cache (the first build downloads every dependency); consider a check that a PR's new migration is newer than every migration on `main` (ADR 0021); add a Linux smoke job (`pnpm app:up`, `curl /api/health/ready`, `docker compose stop`, both api and worker exit 0; a migrate run with a wrong password exits 1), because Windows can't send real signals, so these are only hand-checked today (P0.4 review).
- [ ] **P0.7 Design system:** visual direction, colour and type tokens (Latin + Devanagari), spacing, restyled base components, keyboard-shortcut framework. **Owner's brief (2026-10-30):** modern and clean, not "AI slop" (no generic template or AI-generated look), and easy for shopkeepers to use. *At P0.7, ask for the details: colours, apps whose look they like, light/dark.*
- [ ] Phase 0 journal (`docs/journal/phase-0.md`)

## Phase 1 — Core selling

Foundations under every module:

- [ ] **P1.1 Tenancy & data safety:** businesses and branches tables, `business_id` everywhere, RLS policies, no-`DELETE` grants, cross-business tests [ADRs 0006, 0007]
- [ ] **P1.2 Entry log recording:** append-only log table and the one write helper every module uses; tests [ADR 0007, Module 06]. The default privileges from P0.3 give `app_runtime` UPDATE on every table, so this table's migration must `REVOKE UPDATE`, with a `42501` test in the style of `packages/db/src/roles.test.ts`. If RLS helpers or triggers use `SECURITY DEFINER`, also revoke PUBLIC's default EXECUTE on functions.
- [ ] **DevOps stage 4 — cloud guardrails:** first ask when placement season is (the Free plan's 6-month clock starts at sign-up, so this stage may move later). Then: AWS Free plan account, MFA, no root use, IAM Identity Center, credit-usage budget alert, earn the extra $100 of credits. *Owner does it with Claude's steps.*

Module 00 — answer its open questions first (auto-lock time, password reset, deactivation, counters):

- [ ] **P1.3 Signup & business setup:** signup (5 fields), business-type presets, GST status, settings page
- [ ] **P1.4 Login & sessions:** owner and staff login, Argon2id, sessions, rate limiting, auto-lock, re-authentication [ADR 0009]
- [ ] **P1.5 Staff logins & permissions:** owner creates staff logins, per-person feature switches behind the owner's password, API permission guard, UI hiding
- [ ] **P1.6 Branches:** add branches, branch switcher, branch-scoped data

Module 01 — answer its open questions first (medical costing, built-in units, Excel errors, inter-state transfers):

- [ ] **P1.7 Items:** item fields, units and conversions, prices, GST rate and HSN, MRP rule, Hindi names, search and barcode lookup; archive instead of delete. Decide an ICU collation for item-name sorting; the Docker image alone doesn't make sorting match RDS (ADR 0019).
- [ ] **P1.8 Stock ledger:** stock movements, opening stock, adjustments with reason, negative-stock warn/block, two-counter concurrency tests
- [ ] **P1.9 Excel import** of opening stock
- [ ] **P1.10 Business-type stock features:** batches and expiry (soonest expiry first), variants, IMEI/serial numbers
- [ ] **P1.11 Branch transfers & physical stock count**

DevOps before any real data:

- [ ] **DevOps stage 5 — Terraform:** remote state in S3, network and security groups, the EC2 server with Docker Compose and Caddy, a free domain with HTTPS. Run `packages/db/bootstrap/create-roles.sql` on RDS once by hand; the master user may first need `GRANT app_owner TO <master>` (ADR 0019). Decide whether to `REVOKE CONNECT, TEMP ON DATABASE postgres FROM PUBLIC` (review minor from P0.3). The queue role `app_queue` (ADR 0022) is added to the bootstrap in P2.7; if RDS is bootstrapped before that, P2.7 adds it to RDS with a one-time script run by hand. Secrets go in SSM as `SecureString`s; `migrate` gets only `MIGRATION_DATABASE_URL`, and `api`/`worker` get only `DATABASE_URL` (ADR 0021).
- [ ] **DevOps stage 7 — data safety:** RDS with point-in-time restore, nightly `pg_dump` copy to S3, first restore drill, restore runbook, scheduled stop when idle
- [ ] **DevOps stage 6 — CD:** deploy through Systems Manager on merge with a manual go-ahead, health checks, rollback to the previous image

Modules 02 and 03:

- [ ] **Finalize Module 02** (`/finalize-module 02`), then re-cut P1.12–P1.17
- [ ] **Finalize Module 03** (`/finalize-module 03`), then re-cut P1.18–P1.19
- [ ] **P1.12 GST engine** in `packages/shared`: tax-inclusive/exclusive, CGST+SGST/IGST, composition, rounding; exhaustive tests, no UI
- [ ] **P1.13 Billing screen:** keyboard and scanner flow, cart, customer capture, payment modes
- [ ] **P1.14 Saving a bill:** the atomic transaction, invoice numbering per branch per financial year, idempotency keys; concurrency tests
- [ ] **P1.15 Printing:** 80/58 mm receipt and A4 invoice, PDFs via headless Chromium [ADR 0014]
- [ ] **P1.16 Cancellations & credit notes** (returns)
- [ ] **P1.17 Remaining Module 02 features** decided at finalization (quotations, held bills, GST export…)
- [ ] **P1.18 Udhaar ledger:** running balance, payments, credit-limit check at billing
- [ ] **P1.19 Udhaar views:** overdue buckets, customer statement
- [ ] **P1.20 Demo data v1:** seed a kirana shop with items, bills and udhaar [ADR 0016]
- [ ] Phase 1 journal

## Phase 2 — Running the business

- [ ] Finalize Modules 04, 05, 06, 07, 08 (one session each; re-cut the tasks below afterwards)
- [ ] **P2.1 Suppliers & purchase entries** (stock in, with batch/expiry/IMEI)
- [ ] **P2.2 Supplier ledger, payments, purchase returns**
- [ ] **P2.3 Staff records & attendance**
- [ ] **P2.4 Salary rules & advances** (tests for every rule)
- [ ] **P2.5 Salary slips (PDF) & salary payments**
- [ ] **P2.6 Entry-log viewer:** filters, flags for unusual activity
- [ ] **P2.7 Jobs & alerts:** pg-boss worker, outbox, in-app alerts [ADR 0010]. First create role `app_queue` owning schema `pgboss` (bootstrap + tests that it can't read `public` and `app_runtime` can't touch `pgboss`), and give the worker a second pool as `app_queue` [ADR 0022]. pg-boss's polling then keeps the worker running; `waitForShutdown()` stays for the clean stop.
- [ ] **P2.8 WhatsApp:** Cloud API sender with the test number, templates, daily summary, Outbox page
- [ ] **P2.9 Owner dashboard**
- [ ] **P2.10 Staff dashboard & combined branches view**
- [ ] **P2.11 Demo data v2:** purchases, staff, attendance, salary
- [ ] Chosen ideas from `ideas-backlog.md`
- [ ] **DevOps stage 9 — observability:** structured logs, metrics, dashboards, uptime checks, alert on a failed backup
- [ ] **DevOps stage 10 — security review:** secrets, Trivy image scans, dependency audit, HTTPS, least privilege
- [ ] Phase 2 journal

## Phase 3 — AI assistant

- [ ] Finalize Module 09; choose the model and monthly cap (update ADR 0015); owner creates a Claude Console API key with a spend limit. The key follows `docs/devops/secrets.md`: server-only (`ANTHROPIC_API_KEY` read by `api`), `.env` locally and SSM on AWS, never `VITE_`, never in the image or logs; separate keys for local and demo
- [ ] **P3.1 Demo data v3:** enough history for every example question
- [ ] **P3.2 AI tools layer:** read-only, permission-checked query functions with unit tests
- [ ] **P3.3 Chat:** Claude API tool calling, streaming answers, English/Hindi/Hinglish
- [ ] **P3.4 Eval set:** questions with known answers from demo data; accuracy report
- [ ] **P3.5 Guardrails:** monthly cost cap, permission refusals, ambiguity handling
- [ ] **DevOps stage 11 (stretch):** local Kubernetes with kind and Helm; optional Argo CD
- [ ] **Portfolio polish:** README with architecture diagram and CI badge, demo login, runbooks, "how it's deployed and what it costs"
- [ ] Phase 3 journal
