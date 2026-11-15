# Handoff — latest session

Overwritten at the end of every session. Older handoffs are in git history: `git log -p docs/HANDOFF.md`.

**Session:** 19 — DevOps stage 5 part 1: tools, AWS sign-in, Sydney prices, Terraform plan, 2026-11-12

**Done:**
- PR #14 (stage 4) was merged before this session.
- **Owner's rule (2026-11-12): Claude runs Terraform and the AWS CLI**, explaining as it goes; `plan` first, cost stated, `apply` after the owner's OK. Recorded in `DEVOPS_PLAN.md`, `CLAUDE.md` and the plan.
- **Tools:** AWS CLI 2.40.0 and Terraform 1.17.1 installed with `winget` (1.17.2 exists; upgrade any time). The old CLI v1 launchers in Python's `Scripts` folder were deleted (owner's OK).
- **Sign-in (ADR 0031):** `aws login --profile business-software` (profile Region `ap-southeast-2`). It gives an assumed role, `AccountFullAccessRole`, with 12-hour credentials renewed for up to 90 days. No access keys. Terraform ≥ 1.15 with AWS provider ≥ 6.23 reads it, S3 backend included (from a Classmethod article; the first `terraform init` proves it).
- **Old credentials found:** `~/.aws/credentials` had a working long-lived key for a finished project's IAM user in another account as `[default]`. With the owner's OK, `[default]` was renamed to a named profile; a command without `--profile` now fails with `NoCredentials`. Deactivating the key from the laptop failed (the key may not manage itself; the second old profile's key was already invalid).
- **Checked in Sydney:** `t4g.small` offered and on the Free plan list (which now also has `t8i.micro`/`t8i.small`); RDS PostgreSQL 18.1–18.6 on `db.t4g.micro` with gp3; Ubuntu 26.04 ARM64 image in Canonical's public SSM parameter; Docker's apt repo has `resolute` for arm64.
- **Prices (Pricing API, ADR 0032):** $0.0512 per running hour (EC2 $0.0212, IPv4 $0.005, RDS $0.025) + $4.73 a month (EBS 20 GB $1.92, RDS gp3 20 GB $2.76). ≈ $7.80 a month at ~60 h, ≈ $42 at 24/7. ADR 0011 has a dated note.
- **Latency:** Mumbai ~55–80 ms, Sydney ~270–300 ms, so +0.2 s per round trip. P1.13 now has a note: look items up in the browser.
- **Owner chose (ADR 0032):** auto-assigned IP + DuckDNS, Ubuntu 26.04 LTS ARM64, nightly EventBridge Scheduler stop at 23:30 IST, no budget action.
- **Plan** `docs/plans/2026-11-12-stage-5-terraform.md` for parts 2 and 3.
- Updated: PROGRESS (stage 5 split in three parts, part 1 ticked), `aws-account.md`, `DEVOPS_PLAN.md`, `CLAUDE.md` (AWS sign-in line), `phase-1.md`, interview log (5 entries, 2 questions, 7 glossary terms, Numbers, Pitch).
- **PR #15** (`docs: prepare terraform for stage 5 and record adrs 0031-0032`), branch `docs/devops-stage-5-prep`. All five checks were green; this end-session commit goes on the same PR.

**Half-done:**
- **PR #15** is open, not merged.
- **The plan is waiting for the owner's OK** (`docs/plans/2026-11-12-stage-5-terraform.md`). Nothing has been created in AWS yet; the only resource is stage 4's budget.
- **Owner tasks:**
  - Deactivate, then delete, the old project's access key in *that* account's IAM console (IAM → Users → the user → Security credentials → Access keys). Optionally remove the dead second profile from `~/.aws/credentials`.
  - From stage 4: click the AWS Budgets verification email; turn on 2-step verification on the identity used to sign in to AWS.
  - Check Console Home → Explore AWS → "Earn AWS credits": the budget activity still showed "Not started".

**Next step:**
1. Owner: squash-merge PR #15 when green, then `git switch main`, `git pull`, `git branch -D docs/devops-stage-5-prep`. Read and OK the plan.
2. Next session: `/start-session`, then **stage 5 part 2** on branch `feat/stage-5-network-db-server`, following the plan:
   - `aws login --profile business-software` first if 12 hours have passed.
   - Add `backend.hcl` to `.gitignore` (and commit `backend.hcl.example`); `*.tfvars` is already ignored.
   - Confirm `password_wo` (RDS) and `value_wo` (SSM) exist in AWS provider 6.73 before writing `database.tf`.
   - Bootstrap the state bucket, then network, database, server, schedule. `plan`, state the cost, wait for OK, `apply`.
   - Install the Session Manager plugin (`winget`) to get onto the server.
   - Stop EC2 and RDS at the end; check the next morning that the schedule works.
3. A small PR any time: the **dependency refresh** in PROGRESS.
4. **Owner decisions waiting** (in PROGRESS): `entry_log`'s `id`/`created_at` database-only (P1.4 e); public demo rules and reset (P1.20); thin AI slice after demo data v1.

**Watch out for:**
- **AWS, which account:** always `--profile business-software` (or `AWS_PROFILE`). The laptop has no `[default]` credentials on purpose. Terraform's provider gets `allowed_account_ids` from a git-ignored `terraform.tfvars`.
- **AWS, one-way doors:** never click "Upgrade plan" or "Activate advanced features"; never create or join an Organization or set up Control Tower. On the Free plan AWS can't charge the card; it closes the account when credits or the 6 months (2027-05-12) run out.
- **AWS, money:**
  - State each resource's cost per hour and per month before `apply` (ADR 0032 has the prices).
  - Stop EC2 and RDS after every session. Disks still bill while stopped ($4.73 a month). RDS restarts itself after 7 days stopped.
  - Nothing that bills while idle: no NAT gateway, load balancer, Elastic IP, interface VPC endpoint or Secrets Manager.
- **AWS, Region:** `ap-southeast-2` everywhere. The Pricing API is called with `--region us-east-1` (its endpoint); that works despite the Region lock.
- **AWS, privacy:** console URLs, error messages and `sts` output contain the account ID; mask it (`sed -E 's/[0-9]{12}/<account>/g'`) and never commit it. The state bucket's name goes in git-ignored `backend.hcl` if it contains the ID.
- **Terraform:** secrets never in state (write-only arguments with ephemeral passwords). `terraform destroy`, or deleting anything, needs the owner's explicit OK and, for RDS, a fresh snapshot. RDS has deletion protection.
- **Git Bash mangles `/aws/...` arguments** into Windows paths: prefix `MSYS_NO_PATHCONV=1`. After `winget` installs, open a new terminal (or reload PATH).
- **Credit activities, $20 each:** budget (done, not yet credited); EC2 and RDS with part 2's real resources; Lambda and Bedrock later, tiny, priced first. Never Aurora.
- **Docker Desktop must be running** for the local gitleaks scan and for `pnpm test`/`check`/`db:up`/`app:up`. It was off again; the PR's `secrets` check covered it.
- **Demo-first order (2026-11-10):** keep P1.3's signup creating the first branch, every route naming its permission from P1.4, P1.8's ledger leaving room for batches and serials, stage 7 before P1.3 stores real data. New: P1.13 looks items up in the browser (latency).
- **Checked facts not to rediscover:** pg-boss needs `createSchema: false`; images are `linux/arm64`; no SWC plugin; `crypto.argon2` exists; TypeScript stays `~6.0`; Drizzle stays 0.45; RDS has PostgreSQL 18.6; Ubuntu 26.04 ARM64 is in Sydney.
- **Failure paths (2026-11-10 scan):** throw Nest `HttpException`s for client answers; never `logger.error(error)` with an object, use `describeError(error)`; `createDatabase` listens on every connection; `runProcess` owns `uncaughtException`/`unhandledRejection`; test "the database goes away" with a connection in use.
- **No AI attribution, ever** (`CLAUDE.md` rule 6 overrides tool defaults).
- **Module 00 rules for P1.3/P1.4:**
  - Owner email is unique across all businesses. The login lookup is a `SECURITY DEFINER` function on `DEFINER_ALLOWED`.
  - Staff usernames are unique within a business.
  - Recovery keys and reset tokens are random bytes stored as hashes.
  - Email sending needs an ADR. SES needs a verified domain and must leave its sandbox.
  - Auto-lock (5 min) and staff idle logout (30 min) are per-business settings.
- **Entry log rules (ADR 0028):**
  - Write only through `recordEntry(tx, …)`.
  - A new action goes into `ENTRY_ACTIONS`.
  - `actorId` is null only for the system.
  - Order by `id`.
  - Correct an entry with a new one.
- **Guard rules (`src/tenancy-guard.test.ts`):**
  - Views need `security_invoker`.
  - No column UPDATE on append-only tables.
  - Definer functions must be on `DEFINER_ALLOWED`.
  - Exactly one `app_current_business_id()`.
  - `app_runtime` belongs to no role.
  - A new non-tenant schema goes on `NOT_TENANT_SCHEMAS`.
- **Tenancy rules (ADR 0027):**
  - Tenant tables use `id()`, `businessId()`, `createdAt()` and `tenantPolicy()`, plus hand-written `FORCE`.
  - Keys between tenant tables are composite.
  - One permissive policy.
  - Only `withBusiness`/`withNewBusiness`.
  - Data migrations lift `FORCE` and test the row count.
  - Backups need `BYPASSRLS`.
  - The PostgreSQL error code is on `error.cause.code`.
- **Design rules (web):**
  - Tokens only.
  - Whole Tailwind class names.
  - New text colour pairs go in `contrast.test.ts`.
  - Accept short hex.
  - Native `<dialog>`.
  - Shortcuts via `useShortcut`.
  - CSP is `'self'` only.
  - Every string goes in all three locales.
- **CI and git:** five required checks, PR up to date with `main`; lowercase Conventional PR titles ≤ 72 characters; never edit a migration on `main`; after a squash merge `git branch -D`; never write repo files with PowerShell `Set-Content`.
