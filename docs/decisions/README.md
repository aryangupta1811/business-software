# Decisions (ADRs)

Every technical choice is recorded here as an Architecture Decision Record, so it is never re-debated and its reasons survive. Each ADR also has a short "interview note" — how to explain the choice in an interview.

Create one with `/record-decision <title>`. Template: `0000-template.md`.

| # | Decision | Status | Date |
| --- | --- | --- | --- |
| [0001](0001-online-first-billing.md) | Online-first billing; no offline mode in v1 | Accepted | 2026-10-29 |
| [0002](0002-typescript-monorepo.md) | TypeScript everywhere, in a pnpm monorepo | Accepted | 2026-10-29 |
| [0003](0003-frontend-react-vite-spa.md) | Frontend: React + Vite single-page app | Accepted | 2026-10-29 |
| [0004](0004-backend-nestjs-modular-monolith.md) | Backend: NestJS modular monolith | Accepted | 2026-10-29 |
| [0005](0005-database-postgresql-drizzle.md) | Database: PostgreSQL with Drizzle ORM | Accepted | 2026-10-29 |
| [0006](0006-multi-tenancy-row-level-security.md) | Multi-tenancy: shared tables + Row-Level Security | Accepted | 2026-10-29 |
| [0007](0007-data-safety-enforced-in-database.md) | Data-safety rules enforced by the database | Accepted | 2026-10-29 |
| [0008](0008-money-integer-paise.md) | Money stored as integer paise | Accepted | 2026-10-29 |
| [0009](0009-auth-server-sessions.md) | Login: server-side sessions, Argon2id | Accepted | 2026-10-29 |
| [0010](0010-jobs-outbox-whatsapp.md) | Jobs and WhatsApp: pg-boss, outbox, WhatsApp Cloud API | Accepted | 2026-10-29 |
| [0011](0011-hosting-aws-terraform.md) | Hosting: AWS Free plan, one EC2 server + RDS, Terraform, ₹0 budget | Accepted | 2026-10-29 |
| [0012](0012-ci-cd-github-actions.md) | CI/CD: GitHub Actions with OIDC to AWS | Accepted | 2026-10-29 |
| [0013](0013-testing-strategy.md) | Testing: Vitest, Testcontainers, Playwright | Accepted | 2026-10-29 |
| [0014](0014-printing-and-pdfs.md) | Printing and PDFs: print stylesheets, kiosk printing, headless Chromium | Accepted | 2026-10-29 |
| [0015](0015-ai-assistant-claude-tool-calling.md) | AI assistant: Claude API through permission-checked tools | Accepted (model chosen in Phase 3) | 2026-10-29 |
| [0016](0016-demo-data-seed.md) | Demo data: deterministic seed through the app's services | Accepted | 2026-10-29 |
| [0017](0017-git-workflow.md) | Git workflow: GitHub flow, squash merges, Conventional Commits, public repo | Accepted | 2026-10-30 |
| [0018](0018-code-quality-and-dependency-tooling.md) | Code quality and dependency tooling: ESLint + Prettier, pnpm catalogs, supply-chain guards | Accepted | 2026-10-30 |
| [0019](0019-database-roles-and-local-postgres.md) | Database roles and grants: bootstrap file + default privileges; `pg`, Drizzle 0.45, `postgres:18` locally | Accepted | 2026-10-30 |
