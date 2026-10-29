# Progress

**Current focus:** Phase 0 — foundations (stack and architecture chosen; walking skeleton next)
**Next step:** Owner does P0.0 laptop setup; next session: P0.1 Git workflow, then P0.2 monorepo scaffold (plan first)
**Last updated:** 2026-10-29

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
- [ ] **P0.0 Laptop setup** (owner, before the next session): move the repo out of OneDrive; `wsl --install` in an admin PowerShell, then restart; Docker Desktop (WSL 2 backend), checked with `docker run hello-world`; pnpm (`npm install -g pnpm`); VS Code extensions (ESLint, Prettier, Tailwind CSS IntelliSense, Docker); apply for the GitHub Student Developer Pack. Already installed (checked 2026-10-29): Git 2.56, GitHub CLI 2.103, Node 24.18 (LTS), VS Code; 24 GB RAM, 49 GB free on C:. **Later, at DevOps stage 4:** AWS CLI v2 (the existing `aws` in `Python311\Scripts` is a broken old pip install, so remove it) and Terraform.
- [ ] **P0.1 Git workflow** (DevOps stage 1): move the repo out of OneDrive; branch protection on `main`; PR template; commit message convention (Conventional Commits); `.gitattributes` forcing LF line endings (git warned "LF will be replaced by CRLF"); confirm no secrets in git. *Owner does the GitHub settings with Claude's steps.* Branch protection on a **private** repo needs GitHub Pro, which is free with the GitHub Student Developer Pack, so apply for it first. Alternatively, make the repo public after a secrets check: recruiters need to see it anyway, and public repos get branch protection free (ADR 0012). Owner's choice.
- [ ] **P0.2 Monorepo scaffold:** pnpm workspaces (`apps/web`, `apps/api`, `packages/shared`), strict TypeScript, ESLint + Prettier, Vitest with one passing test, first `packages/shared` money helper written test-first. Fill in Run/Test/Lint in `CLAUDE.md`.
- [ ] **P0.3 Database + Docker Compose** (DevOps stage 2): PostgreSQL in Docker Compose, Drizzle + first migration, migration and runtime database roles, a Testcontainers integration test.
- [ ] **P0.4 API skeleton:** NestJS app with `/health` and one endpoint that reads from the database; `api` and `worker` entry points; Dockerfile; runs in Compose.
- [ ] **P0.5 Web skeleton:** React + Vite app shell calling the API; English/Hindi switch with i18next; `docker compose up` starts everything.
- [ ] **P0.6 CI** (DevOps stage 3): GitHub Actions running lint, type-check, unit and integration tests, and builds on every push/PR; status badge in a new README.
- [ ] **P0.7 Design system:** visual direction, colour and type tokens (Latin + Devanagari), spacing, restyled base components, keyboard-shortcut framework. *Ask the owner for visual preferences.*
- [ ] Phase 0 journal (`docs/journal/phase-0.md`)

## Phase 1 — Core selling

Foundations under every module:

- [ ] **P1.1 Tenancy & data safety:** businesses and branches tables, `business_id` everywhere, RLS policies, no-`DELETE` grants, cross-business tests [ADRs 0006, 0007]
- [ ] **P1.2 Entry log recording:** append-only log table and the one write helper every module uses; tests [ADR 0007, Module 06]
- [ ] **DevOps stage 4 — cloud guardrails:** first ask when placement season is (the Free plan's 6-month clock starts at sign-up, so this stage may move later). Then: AWS Free plan account, MFA, no root use, IAM Identity Center, credit-usage budget alert, earn the extra $100 of credits. *Owner does it with Claude's steps.*

Module 00 — answer its open questions first (auto-lock time, password reset, deactivation, counters):

- [ ] **P1.3 Signup & business setup:** signup (5 fields), business-type presets, GST status, settings page
- [ ] **P1.4 Login & sessions:** owner and staff login, Argon2id, sessions, rate limiting, auto-lock, re-authentication [ADR 0009]
- [ ] **P1.5 Staff logins & permissions:** owner creates staff logins, per-person feature switches behind the owner's password, API permission guard, UI hiding
- [ ] **P1.6 Branches:** add branches, branch switcher, branch-scoped data

Module 01 — answer its open questions first (medical costing, built-in units, Excel errors, inter-state transfers):

- [ ] **P1.7 Items:** item fields, units and conversions, prices, GST rate and HSN, MRP rule, Hindi names, search and barcode lookup; archive instead of delete
- [ ] **P1.8 Stock ledger:** stock movements, opening stock, adjustments with reason, negative-stock warn/block, two-counter concurrency tests
- [ ] **P1.9 Excel import** of opening stock
- [ ] **P1.10 Business-type stock features:** batches and expiry (soonest expiry first), variants, IMEI/serial numbers
- [ ] **P1.11 Branch transfers & physical stock count**

DevOps before any real data:

- [ ] **DevOps stage 5 — Terraform:** remote state in S3, network and security groups, the EC2 server with Docker Compose and Caddy, a free domain with HTTPS
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
- [ ] **P2.7 Jobs & alerts:** pg-boss worker, outbox, in-app alerts [ADR 0010]
- [ ] **P2.8 WhatsApp:** Cloud API sender with the test number, templates, daily summary, Outbox page
- [ ] **P2.9 Owner dashboard**
- [ ] **P2.10 Staff dashboard & combined branches view**
- [ ] **P2.11 Demo data v2:** purchases, staff, attendance, salary
- [ ] Chosen ideas from `ideas-backlog.md`
- [ ] **DevOps stage 9 — observability:** structured logs, metrics, dashboards, uptime checks, alert on a failed backup
- [ ] **DevOps stage 10 — security review:** secrets, Trivy image scans, dependency audit, HTTPS, least privilege
- [ ] Phase 2 journal

## Phase 3 — AI assistant

- [ ] Finalize Module 09; choose the model and monthly cap (update ADR 0015); owner creates a Claude Console API key with a spend limit
- [ ] **P3.1 Demo data v3:** enough history for every example question
- [ ] **P3.2 AI tools layer:** read-only, permission-checked query functions with unit tests
- [ ] **P3.3 Chat:** Claude API tool calling, streaming answers, English/Hindi/Hinglish
- [ ] **P3.4 Eval set:** questions with known answers from demo data; accuracy report
- [ ] **P3.5 Guardrails:** monthly cost cap, permission refusals, ambiguity handling
- [ ] **DevOps stage 11 (stretch):** local Kubernetes with kind and Helm; optional Argo CD
- [ ] **Portfolio polish:** README with architecture diagram and CI badge, demo login, runbooks, "how it's deployed and what it costs"
- [ ] Phase 3 journal
