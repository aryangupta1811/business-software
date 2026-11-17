# Handoff — latest session

Overwritten at the end of every session. Older handoffs are in git history: `git log -p docs/HANDOFF.md`.

**Session:** 21 — AWS account switch done (Mumbai, admin IAM user, bootstrap applied) and the Agent Toolkit for AWS set up, 2026-11-17

**Done:**
- **PR #16** (stage 5 Terraform + switch plan) squash-merged on the owner's word; branch `docs/aws-account-switch` from the new `main`.
- **New AWS account checked** (console and CLI, read-only): Free plan, `ACTIVE`, $100, ends 2027-05-17, empty, **not locked to a Region**. Mumbai and Sydney compared: Mumbai 0.06 s vs 0.30 s per round trip, $0.0372 vs $0.0512 per running hour. **Owner chose Mumbai.** Terraform's Region changed in 4 places; `validate` passes.
- **Sign-in:** old profile renamed `business-software-old` (backup `~/.aws/config.bak-2026-11-17`). Root MFA on (`iphone13`). Owner created an admin IAM user (`AdministratorAccess`, MFA, no access keys; its name contains a personal name, so the repo says "the admin IAM user"). The CLI's `business-software` profile is signed in as that user, Region `ap-south-1`.
- **Guardrails as code:** `allowed_account_ids` in both roots' git-ignored `terraform.tfvars`; the budget `monthly-credit-burn` as `infra/terraform/bootstrap/budget.tf` (alert address in `terraform.tfvars`).
- **First apply (owner's OK):** bootstrap root, 8 resources (state bucket + settings, budget), about $0. `backend.hcl` written (git-ignored), backend block switched on, `terraform init -migrate-state`; a `plan` afterwards says "No changes". The pre-migration copy of the local state was only in the session scratchpad; the bucket's versioning keeps history from now on.
- **Agent Toolkit for AWS** (owner's request): `uv` via winget; `aws configure agent-toolkit` installed 25 skills (Claude Code, Codex) and `aws-mcp` (Claude Code, Gemini CLI). The Claude Code entry was rewritten: Python launch, IPv4 wrapper `~/.aws-mcp/run_ipv4.py`, `--profile business-software`, `--read-only`, pinned 1.8.0, telemetry off. `claude mcp list` shows Connected. AWS's rules live in `docs/devops/aws-agent-rules.md` (imported from `CLAUDE.md`, with this project's overrides on top).
- **Windows IPv4 preference** set by the owner (admin PowerShell, prefix policy 60).
- **ADR 0033** (replaces 0030; dated notes on 0011, 0031, 0032). Docs updated: `aws-account.md` (rewritten for the new account, "Switching accounts", laptop tools), `architecture.md`, `DEVOPS_PLAN.md`, both plans' status, `CLAUDE.md` (Mumbai, admin IAM user, rules import), five interview log entries.

**Half-done:**
- **Stage 5 part 2:** the demo root (`infra/terraform/demo/`) is written and validated, **not planned or applied** in the new account. Its `terraform init -backend=false` returned 1 this session (likely the IPv6 provider-download problem; `validate` still passed with the providers it had). The real `init` with `-backend-config=../backend.hcl` hasn't run.
- **Not checked yet:** RDS PostgreSQL 18's `rds.force_ssl` default (now possible with the new account); the cloud-init file has never booted.
- **Owner tasks:** the budget confirmation email is done (owner, end of session). Still: deactivate and delete the other project's old access key in its own IAM console (carried over); optionally close the old account (the owner's click, irreversible).
- **Credit activities:** check whether the Terraform-made budget counted for the "budget" activity (Console Home → Explore AWS widget).
- The Gemini CLI's `aws-mcp` entry was left as AWS generated it; it will hit the same Windows block if used.

**Next step:**
1. Done: PR #17 (account switch) squash-merged by Claude on the owner's word (`cb465bb`); local branch deleted.
2. Next session: `/start-session`, then **stage 5 part 2 continued** on a new branch from `main` (e.g. `feat/stage-5-demo-stack`): check `rds.force_ssl`; `terraform init -backend-config=../backend.hcl` in `demo/` (rebuild the provider mirror if IPv6 breaks the download, see below); `plan`; state the cost (about $0.0372 per running hour + $4.44 a month); `apply` after the owner's OK; the checks in the stage 5 plan's step 7; stop both instances.
3. A small PR any time: the **dependency refresh** in PROGRESS.
4. **Owner decisions waiting** (in PROGRESS): `entry_log`'s `id`/`created_at` database-only (P1.4 e); public demo rules and reset (P1.20); thin AI slice after demo data v1.

**Watch out for:**
- **AWS, which account and who:** before every `plan` and `apply`, `aws sts get-caller-identity --profile business-software` must show `user/…` (not `root`) in the new account (its ID is the one in `terraform.tfvars`; mask it in output). `aws login` reuses whoever Chrome is signed in as; sign out of root first. The old account is profile `business-software-old` and stays empty.
- **AWS, Region:** `ap-south-1` everywhere (Terraform's 4 places and the profile). The Agent Toolkit service is `us-east-1`; the Pricing API is called with `--region us-east-1`.
- **AWS, one-way doors:** never click "Upgrade plan" (the Free Tier page shows the link) or "Activate advanced features"; no Organization or Control Tower. Closing an account is the owner's click.
- **AWS, money:** state each resource's cost before `apply` (Mumbai prices: ADR 0032's dated note). Stop EC2 and RDS after every session; disks bill while stopped ($4.44 a month); RDS restarts itself after 7 days stopped. Nothing that bills while idle: no NAT gateway, load balancer, Elastic IP, interface VPC endpoint or Secrets Manager. No Cost Explorer API calls ($0.01 each).
- **AWS, privacy:** account IDs, the IAM user's name, the sign-in URL and the alert email never go in the repo. They live only in git-ignored `terraform.tfvars` and `backend.hcl` (the bucket name contains the ID).
- **AWS MCP server:** read-only by design (`docs/devops/aws-agent-rules.md`): docs, skills and Region info only. Read the account with the CLI; change it only with Terraform. If it shows "Failed to connect", run the proxy by hand with `--log-level DEBUG` (the command is in `docs/devops/aws-account.md`) and read the real error; `-32602` hid an `httpx.ConnectError`.
- **This network breaks IPv6 at the TLS step:** TCP over IPv6 connects, TLS is reset. Hit by Terraform provider downloads, docs fetches and the MCP proxy. Windows now prefers IPv4 (prefix policy 60), but async Python (anyio) and maybe Go still try IPv6 first. Use `curl -4`. If `terraform init` fails with "connection was forcibly closed": download the provider zips with `curl -4`, check them against HashiCorp's `SHA256SUMS`, point Terraform at the folder with a `filesystem_mirror` in a file named by `TF_CLI_CONFIG_FILE`; lock files with `terraform providers lock -fs-mirror=<folder> -platform=windows_amd64 -platform=linux_amd64`.
- **Windows Application Control** blocks unsigned `.exe` launchers that uv creates for tools; run the package as `uvx --from <pkg> python -m <module>`. A `netsh` change needs an admin PowerShell and fails quietly otherwise: check the result.
- **Terraform:**
  - Secrets never in state (write-only arguments with ephemeral passwords). To rotate the RDS master password, raise `db_password_version` by one.
  - `terraform destroy`, or deleting anything, needs the owner's explicit OK and, for RDS, a fresh snapshot. RDS has deletion protection; the state bucket has `prevent_destroy`.
  - Every root: `terraform init -backend-config=../backend.hcl`. In a fresh account the bootstrap backend block is commented out for the first apply (`aws-account.md`, "Switching accounts").
- **Git Bash mangles `/aws/...` arguments** into Windows paths: prefix `MSYS_NO_PATHCONV=1`. After `winget` installs, open a new terminal (or reload PATH).
- **"Merged" isn't merged until GitHub says so:** check `gh pr view <n> --json state` before switching to `main`.
- **Credit activities, $20 each:** all five restart in the new account. EC2 and RDS with part 2's real resources; Lambda and Bedrock later, tiny, priced first. Never Aurora.
- **Docker Desktop must be running** for the local gitleaks scan and for `pnpm test`/`check`/`db:up`/`app:up`.
- **Demo-first order (2026-11-10):** keep P1.3's signup creating the first branch, every route naming its permission from P1.4, P1.8's ledger leaving room for batches and serials, stage 7 before P1.3 stores real data. P1.13: with Mumbai's ~0.06 s a server lookup per scan is possible, but the browser-side catalogue copy is still planned; P1.13 decides (ADR 0033).
- **Checked facts not to rediscover:** pg-boss needs `createSchema: false`; images are `linux/arm64`; no SWC plugin; `crypto.argon2` exists; TypeScript stays `~6.0`; Drizzle stays 0.45; AWS provider 6.73.0 has `password_wo` and `value_wo`; in Mumbai (new account) `t4g.small` is Free plan eligible, RDS has PostgreSQL 18.6 on `db.t4g.micro` gp3, and the Ubuntu 26.04 ARM64 image exists.
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
