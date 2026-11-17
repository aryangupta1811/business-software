# Handoff — latest session

Overwritten at the end of every session. Older handoffs are in git history: `git log -p docs/HANDOFF.md`.

**Session:** 22 — fast track Day 1: the 10-day plan, the dependency refresh, stage 5 part 2 applied in Mumbai, sitting 1 (Modules 01–03 settled), 2026-11-17

**Done:**
- **The fast-track plan** (PR #19, `docs/plans/2026-11-17-fast-track.md`), at the owner's request: the whole project in 10 days (Days 1–10 = 2026-11-17 to 11-26), the same scope and the same checks. It runs up to four lanes in git worktrees with one merge queue, three evening question sittings, and one plan OK per morning. `CLAUDE.md` rules 5 and 9, `git-workflow.md` and the `/start-session` skill were changed to match. Decision D2 was corrected later the same day: WhatsApp was already decided in ADR 0010.
- **Dependency refresh** (PR #20, lane 2, done by a background agent):
  - Every minor and patch update is in. typescript-eslint stays on 8.72.1, because 8.73's new rule needs its own task.
  - Three narrow pnpm overrides fix the dev audit advisories.
  - picomatch GHSA-fc5q-39xc-vjpf (high, dev-only) has no patched release yet.
  - An independent review read every override's call sites.
- **Stage 5 part 2** (PR #21, lane 1, two applies, each with the owner's OK): 29 resources in Mumbai.
  - The Free plan **refused 7-day RDS backups**, so retention is 1 day (ADR 0011 dated note).
  - An **apostrophe** in a security group rule description was refused.
  - The partial first apply left **RDS and SSM with different passwords**. Fixed with `db_password_version` = 2, plus `depends_on`, plus a recovery rule in the runbook.
  - Step 7 checks all pass (aarch64, Docker, swap, IMDSv2, PostgreSQL 18.6 over TLS 1.3, non-TLS refused, nothing reachable from outside, the password not in state, schedules enabled).
  - CI's `check` job now runs Terraform `fmt` and `validate`.
  - New runbook `docs/devops/terraform.md`. Session Manager plugin installed.
  - **EC2 and RDS stopped.**
- **Sitting 1** (owner, evening):
  - Module 01's four open questions answered (`01` #15–18). #4 now says medical profit uses the batch actually sold.
  - **Modules 02 and 03 DECIDED.** The owner took every recommendation and confirmed the drafts plus Claude's additions.
  - **D1: stay free.** DuckDNS, SES sandbox, and the recovery key for demo visitors.
  - **D3: Claude Sonnet 5.5, $15 a month** (ADR 0015 dated note).
- Day-end docs: PROGRESS header and status tables; interview log (8 entries today, plus Pitch and Numbers moved to Mumbai).

**Half-done:**
- **Stage 5 part 2 leftovers:**
  - Watch a nightly stop actually stop a *running* server (both were stopped by hand today, so tonight's schedule only hits stopped instances), or read the schedules' CloudWatch metrics.
  - The owner checks the EC2 and RDS credit activities in Console Home.
- **The 1-day backup window** (22:00–22:30 IST) may never be reached if sessions stop RDS earlier. After a few sessions, check `EarliestRestorableTime` and the automated snapshots (`terraform.md`, "Still to check").
- **typescript-eslint 8.73** (`no-unsafe-class-instance-assignment` flags 5 NestJS option objects) needs its own small task.
- **Owner tasks with lead time:**
  - **DuckDNS:** sign in at duckdns.org and pick a subdomain *before Day 2's lane 1*. Claude will say how to get the token into SSM without it passing through the chat.
  - **Meta:** a developer account, an app and the WhatsApp Cloud API test number, by Day 4 (P2.8 on Day 5).
  - **Claude Console:** two API keys with a $15 spend limit (local and demo), by Day 7.
  - **Carried over:** delete the other project's old access key; optionally close the old AWS account.

**Next step:**
1. `/start-session`. Day 2 (2026-11-18), with plans for all four lanes in one OK:
   - lane 1: **stage 5 part 3**;
   - lane 2: **P1.3 Signup**;
   - lane 3: drafts for **sitting 2** (Modules 05, 06, 07 and D4, `entry_log` columns database-only);
   - lane 4: **P1.12 GST engine**.
2. Start EC2 and RDS only when lane 1 needs them (`terraform.md`, "Start and stop"); stop both at the end.
3. Evening: sitting 2, then the day-end docs and PRs.

**Watch out for:**
- **Fast track working rules** (`docs/plans/2026-11-17-fast-track.md`, sections 3–4):
  - Lane worktrees go in **sibling folders** (`../Business-software-laneN`), made by hand with `git worktree add`. The Agent tool's `isolation: "worktree"` was refused today: the harness wouldn't use `.claude/worktrees`.
  - gitleaks can't read a worktree's `.git` file inside Docker. Scan a lane's commits from the main checkout with `--log-opts="origin/main..<branch>"`.
  - Merge one PR at a time; after each merge, rebase the next branch, regenerate generated files and run `pnpm check` again.
  - Every PR gets a fresh-context review before merge. Today's two reviews each found a docs claim that went too far.
  - **PR titles ≤ 72 characters.** #20 failed `pr-title` at 74.
- **No AI attribution, ever** (`CLAUDE.md` rule 6 overrides tool defaults). Today a commit with a `Co-Authored-By` line was blocked; the merged history is clean.
- **pnpm 12** printed "Agent skills awaiting approval: @tanstack/react-router, @tanstack/router-plugin. Run `pnpm approve`". Don't approve without the owner; read what it installs first.
- **AWS, which account and who:** before every `plan` and `apply`, `aws sts get-caller-identity --profile business-software` must show `user/…` (not `root`) in the new account (its ID is the one in `terraform.tfvars`; mask it in output). `aws login` reuses whoever Chrome is signed in as; sign out of root first.
- **AWS, Free plan limits:** never "upgrade your account plan", whatever an error message suggests (ADR 0033). Read the whole error, then fit the code to the limit.
- **AWS, Region:** `ap-south-1` everywhere. The Agent Toolkit service is `us-east-1`; the Pricing API is called with `--region us-east-1`.
- **AWS, money:** state each resource's cost before `apply`. Stop EC2 and RDS after every session: disks bill while stopped ($4.44 a month), and RDS restarts itself after 7 days stopped. Nothing that bills while idle: no NAT gateway, load balancer, Elastic IP, interface VPC endpoint or Secrets Manager. No Cost Explorer API calls ($0.01 each).
- **AWS, privacy:** account IDs, instance IDs, the RDS host name, the IAM user's name, the sign-in URL and the alert email never go in the repo.
- **AWS, server access:** no SSH. Use `aws ssm start-session`, or Run Command for scripts (`terraform.md`). Read secrets into a variable on the server; never print them.
- **Database password:** to rotate, or after any failed apply that touched RDS or its SSM copy, follow the recovery rule in `terraform.md` (start RDS first, raise `db_password_version`, verify with a login).
- **AWS MCP server:** read-only by design (`docs/devops/aws-agent-rules.md`): docs, skills and Region info only. Read the account with the CLI; change it only with Terraform.
- **This network breaks IPv6 at the TLS step.** The provider-mirror recipe is now in `terraform.md`. Today's `init` reused cached providers and didn't need it.
- **Windows Application Control** blocks unsigned `.exe` launchers that uv creates; run `uvx --from <pkg> python -m <module>`.
- **Git Bash mangles `/aws/...` and `/business-software/...` arguments** into Windows paths: prefix `MSYS_NO_PATHCONV=1`.
- **"Merged" isn't merged until GitHub says so:** check `gh pr view <n> --json state` before switching to `main`.
- **Docker Desktop must be running** for gitleaks, `pnpm test`/`check`/`db:up`/`app:up`. It was off at the start of today; it can be started from `C:\Program Files\Docker\Docker\Docker Desktop.exe`.
- **Decided today, for the coming tasks:**
  - P1.4: no domain; SES stays in its sandbox, and the email ADR says what the demo does.
  - P1.12: place of supply, GST after discount, round-off line.
  - P1.13: held bills, split payments, discount limits.
  - P1.14: never edit a saved bill.
  - P1.18: oldest bills cleared first; advance balance.
  - The full re-cut notes are under the two Finalize lines in PROGRESS.
- **Checked facts not to rediscover:**
  - `rds.force_ssl` is 1 by default on PostgreSQL 18.
  - The Free plan caps RDS backup retention below 7 days.
  - AWS applies an RDS master password change at once, with no outage.
  - Older facts: pg-boss needs `createSchema: false`; images are `linux/arm64`; no SWC plugin; `crypto.argon2` exists; TypeScript stays `~6.0`; Drizzle stays 0.45; AWS provider 6.73.0 has `password_wo` and `value_wo`.
- **Failure paths (2026-11-10 scan):** throw Nest `HttpException`s for client answers; never `logger.error(error)` with an object, use `describeError(error)`; `createDatabase` listens on every connection; `runProcess` owns `uncaughtException`/`unhandledRejection`.
- **Module 00 rules for P1.3/P1.4:**
  - Owner email is unique across all businesses. The login lookup is a `SECURITY DEFINER` function on `DEFINER_ALLOWED`.
  - Staff usernames are unique within a business.
  - Recovery keys and reset tokens are random bytes stored as hashes.
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
  - Definer functions go on `DEFINER_ALLOWED`.
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
- **CI and git:**
  - Five required checks, and the PR must be up to date with `main`.
  - Lowercase Conventional PR titles, ≤ 72 characters.
  - Never edit a migration on `main`.
  - After a squash merge, `git branch -D`.
  - Never write repo files with PowerShell `Set-Content`.
