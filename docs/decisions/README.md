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
| [0015](0015-ai-assistant-claude-tool-calling.md) | AI assistant: Claude API through permission-checked tools | Accepted (Sonnet 5.5, $15/month cap, 2026-11-17) | 2026-10-29 |
| [0016](0016-demo-data-seed.md) | Demo data: deterministic seed through the app's services | Accepted | 2026-10-29 |
| [0017](0017-git-workflow.md) | Git workflow: GitHub flow, squash merges, Conventional Commits, public repo | Accepted | 2026-10-30 |
| [0018](0018-code-quality-and-dependency-tooling.md) | Code quality and dependency tooling: ESLint + Prettier, pnpm catalogs, supply-chain guards | Accepted | 2026-10-30 |
| [0019](0019-database-roles-and-local-postgres.md) | Database roles and grants: bootstrap file + default privileges; `pg`, Drizzle 0.45, `postgres:18` locally | Accepted | 2026-10-30 |
| [0020](0020-api-build-and-runtime.md) | API build and runtime: project references + `source` export condition, Express, built-in JSON logs, one slim non-root image with three commands | Accepted | 2026-10-30 |
| [0021](0021-production-migrations.md) | Production migrations: one-shot `migrate` container as the owner role, before api and worker start | Accepted | 2026-10-30 |
| [0022](0022-job-queue-database-role.md) | Job-queue database role: pg-boss gets its own role owning only schema `pgboss` | Accepted (built in P2.7) | 2026-10-30 |
| [0023](0023-web-build-serving-and-languages.md) | Web app build, serving and languages: Caddy in Compose, hashed-file caching, strict CSP, file-based routes, English/Hindi/Hinglish | Accepted | 2026-10-30 |
| [0024](0024-ci-pipeline.md) | CI pipeline: five required checks (check, secrets, migrations, smoke, pr-title), SHA-pinned actions, no secrets | Accepted | 2026-10-31 |
| [0025](0025-design-system.md) | Design system: Apple-clean tokens with a contrast test, IBM Plex self-hosted, light by default with no-flash dark mode | Accepted | 2026-10-31 |
| [0026](0026-keyboard-shortcuts-and-native-dialog.md) | Keyboard shortcuts: own small registry (physical keys, scanner-safe in fields); native `<dialog>` for modals | Accepted | 2026-10-31 |
| [0027](0027-tenancy-implementation.md) | Tenancy implementation: UUIDv7, RLS policies in the Drizzle schema + hand-written `FORCE`, `withBusiness` as the one way in, a catalogue guard test | Accepted | 2026-11-01 |
| [0028](0028-entry-log-table.md) | Entry log: one append-only row per action, `before`/`after` JSON, a nullable actor without a key until P1.4 | Accepted | 2026-11-01 |
| [0029](0029-aws-account-access.md) | AWS account access: root locked away, an IAM user with MFA, no AWS Organizations on the Free plan | Replaced by 0030 | 2026-11-02 |
| [0030](0030-aws-new-experience-sydney.md) | AWS account: new projects-based Free plan, Region Sydney (`ap-southeast-2`), a budget that leaves out credits; never upgrade or activate advanced features | Replaced by 0033 | 2026-11-12 |
| [0031](0031-laptop-aws-sign-in.md) | Laptop sign-in for the AWS CLI and Terraform: `aws login` with a named profile, `allowed_account_ids` guard, no access keys | Accepted | 2026-11-12 |
| [0032](0032-stage-5-server-shape-and-cost.md) | Stage 5 server shape: Ubuntu 26.04 ARM64, auto-assigned IP + DuckDNS, nightly stop; Sydney cost ≈ $0.05 per running hour + $4.73 a month | Accepted | 2026-11-12 |
| [0033](0033-new-aws-account-mumbai.md) | New AWS account: Free plan in Mumbai (`ap-south-1`), root locked away, an admin IAM user with MFA through `aws login`, budget and account lock as Terraform, read-only Agent Toolkit for AWS | Accepted | 2026-11-17 |
| [0034](0034-image-registry-and-demo-deploy.md) | Images on GHCR (public), built on GitHub's ARM64 runner and tagged by commit; the demo server deploys a commit through Run Command (no SSH), boots through a systemd service | Accepted | 2026-11-18 |
| [0035](0035-password-hashing.md) | Passwords: Node's built-in Argon2id (19 MiB, 2 passes), stored as PHC strings, checked against RFC 9106's test vector | Accepted | 2026-11-18 |
| [0036](0036-api-request-rules.md) | API request rules: shared Zod body schemas through a pipe, every route `@Public()` or `@Permission()`, a global guard that fails closed, a route census test | Accepted | 2026-11-18 |
| [0037](0037-database-backups.md) | Database backups: nightly `pg_dump` to S3 as a read-only role `app_backup` (a `backup_read` policy on every tenant table, as RDS has no `BYPASSRLS`), put-only server access, restore drill with row counts | Accepted | 2026-11-19 |
| [0038](0038-sessions-devices-and-request-protection.md) | Sessions and remembered computers: `<businessId>.<token>` cookies (session ends with Chrome, device for 400 days), CSRF by same-origin check plus a session-derived token, lock and idle on the server's clock with the web app in step, in-memory rate limits and an Argon2 queue | Accepted | 2026-11-19 |
| [0039](0039-login-across-businesses.md) | Login by email across businesses: `auth.owner_logins` in a schema the app can't use, read and written only by two `SECURITY DEFINER` functions with a pinned `search_path` | Accepted | 2026-11-19 |
| [0040](0040-email-service.md) | Email: one `Mailer` interface; Amazon SES v2 with the instance role on the server (sandbox, verified recipients only), Mailpit locally, a fake in tests; sent after commit, best effort | Accepted | 2026-11-20 |
| [0041](0041-database-timeouts.md) | Database timeouts: `lock_timeout` 3 s, `statement_timeout` 10 s, `idle_in_transaction_session_timeout` 15 s as start-up parameters from `createDatabase`; a lock timeout answers `503 busy` with `Retry-After` | Accepted | 2026-11-20 |
| [0042](0042-demo-server-zone.md) | Demo server: keep `t4g.small` (ARM64, 2 GB), move it to `ap-south-1b` after two days of `InsufficientInstanceCapacity` in `1a`; retry at a quieter hour if `1b` refuses too | Accepted | 2026-11-21 |
| [0043](0043-billing-catalogue-copy.md) | Billing counter: the catalogue copied into the browser's memory, synced every 60 s by `updated_at` from 60 s before the last `serverTime` (the overlap covers transactions that commit late), a full reload every 30 minutes; the server re-prices every bill at save | Accepted | 2026-11-21 |
| [0044](0044-staff-permissions.md) | Staff permissions: stored as changes from the defaults (`permissions_added` and `permissions_removed` on `users`), computed by `effectivePermissions` and read on every request, so a later module's permission takes its default and a change reaches an open session on its next click; names checked by Zod, never by the database | Accepted | 2026-11-22 |
| [0045](0045-computers-branch-and-picker.md) | Branches: a session works in its computer's branch (every write is recorded there); the owner's picker is only `?branch=<id>` or `?branch=all` on read pages; staff work at their home or ticked branches, checked on every request; invoice numbers per branch with its code; branches archived, never deleted | Accepted | 2026-11-22 |
| [0046](0046-alerts-same-transaction.md) | Alerts: raised and cleared in the same transaction as the stock or level change (not via the outbox, not computed on read); one open alert per subject, branch and family by a partial unique index; app switches as `businesses.alert_types` | Accepted | 2026-11-22 |
| [0047](0047-bills-append-only.md) | Saved bills: `bills`, `bill_lines` and `bill_payments` append-only (UPDATE revoked, on the guard's list), each bill keeping its own copies of its number, seller, buyer and line details; a cancellation (P1.16) is a row in its own table; the invoice counter is a locked row updated in place | Accepted | 2026-11-22 |
| [0048](0048-attendance-stores-only-marks.md) | Attendance: only the marks people make are stored (`attendance_marks`, one row per person per day, versioned); every other day is its default from one pure function, `dayStatus`; `salary_rates` append-only like bills; shop holidays archived, never deleted | Accepted | 2026-11-22 |
| [0049](0049-whatsapp-click-to-chat-in-v1.md) | WhatsApp in v1: click-to-chat links (`wa.me`) the owner sends from WhatsApp Web or Desktop, PDFs attached by hand; the Cloud API, outbox, daily summary and automatic sends wait for P2.8 in the backlog (ADR 0010 unchanged) | Accepted | 2026-11-22 |
| [0050](0050-udhaar-ledger.md) | Udhaar: an append-only ledger (`udhaar_entries`) plus one locked balance row per customer, changed only by `moveUdhaar`; "oldest bills first" computed from the ledger when read (`unpaidEntries`), never stored; the account is locked last in a bill save (counter, stock, then account); a payment made by mistake is reversed by the owner, never edited | Accepted | 2026-11-24 |
