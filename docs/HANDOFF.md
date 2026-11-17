# Handoff — latest session

Overwritten at the end of every session. Older handoffs are in git history: `git log -p docs/HANDOFF.md`.

**Session:** 20 — DevOps stage 5 part 2 started: Terraform written, then paused for an AWS account switch, 2026-11-15

**Done:**
- **PR #15** (stage 5 part 1) squash-merged by Claude on the owner's word; `main` updated, the old branch deleted.
- **The owner approved** `docs/plans/2026-11-12-stage-5-terraform.md`.
- **Terraform written, not applied** (`infra/terraform/`):
  - `bootstrap/`: the state bucket (versioning, SSE-S3, public access blocked, TLS-only policy, old versions expire after 90 days). Its backend block is commented out until the first apply; then `terraform init -migrate-state -backend-config=../backend.hcl`.
  - `demo/`: `versions.tf`, `backend.tf` (S3 with `use_lockfile`), `variables.tf`, `network.tf`, `database.tf`, `server.tf`, `cloud-init.yaml`, `schedule.tf`, `outputs.tf`.
  - `backend.hcl.example` and two `terraform.tfvars.example`; `backend.hcl` added to `.gitignore`. Both `.terraform.lock.hcl` files are committed, with hashes for `windows_amd64` and `linux_amd64`.
  - `terraform fmt -check` and `terraform validate` pass on both roots (with `init -backend=false`).
- **Confirmed in AWS provider 6.73.0's schema:** `password_wo` (RDS) and `value_wo` (SSM) are write-only; `ephemeral "random_password"` exists in `random` 3.9.1. The plan's open question is closed.
- **Added beyond the plan:** `cpu_credits = "standard"` on the server (`t4g` defaults to `unlimited`, which bills for extra CPU); IMDS hop limit 1 (containers can't reach the instance's credentials); `user_data_replace_on_change = true` (cloud-init runs only at first boot); the VPC's main route table taken over.
- **The owner decided to move to a new AWS account** before anything is created: signing in to the current project has become difficult. Plan written: `docs/plans/2026-11-15-aws-account-switch.md` (8 steps, with a gate that stops if the new account isn't on the Free plan).
- Unrelated: the Claude desktop app once failed to start a session with `Script not found "stream-json"`. That was the app's own Claude Code binary (probably caught mid-update), not this repo. Restarting the app clears it.

**Half-done:**
- **Nothing exists in AWS** except the old account's budget. No `terraform.tfvars`, no `backend.hcl`, no state file anywhere.
- **Stage 5 part 2** stopped before the first `plan`: the laptop's `aws login` session had expired (normal after 12 hours), and then the owner chose to switch accounts.
- **The account switch plan needs the owner's OK and three answers** (top of the plan): what exactly fails at sign-in; new account or new project; what happens to the old account.
- **ADR 0033** (the account switch) is not written yet: it waits for the new account's facts (plan step 4).
- **Not checked yet:** whether RDS PostgreSQL 18 sets `rds.force_ssl = 1` by default (needs AWS access); the cloud-init file has never booted.
- **Owner tasks carried over:** deactivate and delete the other project's old access key in its IAM console; from stage 4, the budget email and 2-step verification now apply to the **new** account.

**Next step:**
1. Owner: open the new AWS account (plan step 1: never click "Upgrade plan" or "Activate advanced features"; note the plan, the credits, the end date and the Region; keep the account ID in the password manager).
2. Next session: `/start-session`, then the **account switch** on branch `docs/aws-account-switch`, following the plan from step 2: rename the old profile to `business-software-old`, owner signs out of the old account in the browser, `aws login --profile business-software`, read the facts, the gate, the guardrails, ADR 0033 and the doc updates.
3. Then **stage 5 part 2** on a new branch from `main`, at "plan the bootstrap bucket, state the cost, wait for OK".
4. A small PR any time: the **dependency refresh** in PROGRESS.
5. **Owner decisions waiting** (in PROGRESS): `entry_log`'s `id`/`created_at` database-only (P1.4 e); public demo rules and reset (P1.20); thin AI slice after demo data v1.

**Watch out for:**
- **AWS, which account:** from the switch on there are two accounts. Before every `plan` and `apply`, run `aws sts get-caller-identity --profile business-software` (masked). `allowed_account_ids` gets the **new** ID only. The old account stays empty.
- **AWS, the new account's plan:** the Free plan is for new AWS customers only. If the new account shows the Paid plan, stop: the card can then be charged (switch plan, step 4).
- **AWS, sign-in:** `aws login` uses whatever account the browser is signed in to. Sign out of the old one first.
- **AWS, one-way doors:** never click "Upgrade plan" or "Activate advanced features"; never create or join an Organization or set up Control Tower. Closing an account can't be undone and is the owner's click.
- **AWS, money:**
  - State each resource's cost per hour and per month before `apply` (ADR 0032 has Sydney's prices; redo them if the Region changes).
  - Stop EC2 and RDS after every session. Disks still bill while stopped ($4.73 a month). RDS restarts itself after 7 days stopped.
  - Nothing that bills while idle: no NAT gateway, load balancer, Elastic IP, interface VPC endpoint or Secrets Manager.
- **AWS, Region:** `ap-southeast-2` is written in 4 places (`bootstrap/main.tf`, `demo/backend.tf`, `demo/variables.tf`, and the laptop's profile). Change them only if the new account's Region differs. The Pricing API is called with `--region us-east-1`.
- **AWS, privacy:** console URLs, error messages and `sts` output contain the account ID; mask it (`sed -E 's/[0-9]{12}/<account>/g'`) and never commit it. The state bucket's name contains the ID, so it lives in git-ignored `backend.hcl`.
- **Terraform:**
  - Secrets never in state (write-only arguments with ephemeral passwords). To rotate the RDS master password, raise `db_password_version` by one.
  - `terraform destroy`, or deleting anything, needs the owner's explicit OK and, for RDS, a fresh snapshot. RDS has deletion protection.
  - **Provider downloads fail on this network over IPv6** (`releases.hashicorp.com` resets the connection; IPv4 works). `terraform init` then fails with "connection was forcibly closed". Workaround used: download the provider zips with `curl -4`, check them against HashiCorp's `SHA256SUMS`, and point Terraform at the folder with a `filesystem_mirror` in a file named by `TF_CLI_CONFIG_FILE`. The mirror was in a temporary folder and is gone; rebuild it if `init` fails again. Lock files: `terraform providers lock -fs-mirror=<folder> -platform=windows_amd64 -platform=linux_amd64`.
- **Git Bash mangles `/aws/...` arguments** into Windows paths: prefix `MSYS_NO_PATHCONV=1`. After `winget` installs, open a new terminal (or reload PATH).
- **"Merged" isn't merged until GitHub says so:** check `gh pr view <n> --json state` before switching to `main`.
- **Credit activities, $20 each:** all five restart in a new account. Budget; EC2 and RDS with part 2's real resources; Lambda and Bedrock later, tiny, priced first. Never Aurora.
- **Docker Desktop must be running** for the local gitleaks scan and for `pnpm test`/`check`/`db:up`/`app:up`. It was off again; the PR's `secrets` check covered it.
- **Demo-first order (2026-11-10):** keep P1.3's signup creating the first branch, every route naming its permission from P1.4, P1.8's ledger leaving room for batches and serials, stage 7 before P1.3 stores real data. P1.13 looks items up in the browser (latency).
- **Checked facts not to rediscover:** pg-boss needs `createSchema: false`; images are `linux/arm64`; no SWC plugin; `crypto.argon2` exists; TypeScript stays `~6.0`; Drizzle stays 0.45; AWS provider 6.73.0 has `password_wo` and `value_wo`; in the old account's Region, RDS has PostgreSQL 18.6 and Ubuntu 26.04 ARM64 exists (recheck in the new account).
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
