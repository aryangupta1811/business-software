# Handoff — latest session

Overwritten at the end of every session. Older handoffs are in git history: `git log -p docs/HANDOFF.md`.

**Session:** 18 — DevOps stage 4 check: the AWS account, Region Sydney, a budget without credits, 2026-11-12

**Done:**
- PR #13 (deep scan) was merged before this session; `main` was clean and the old local branches were gone.
- **The owner asked whether to put AWS at the end to save money.** We worked it through: the Free plan's 6 months run from sign-up whether used or not, and credits drop only while resources exist. So the plan stays **cloud now, running only for sessions and demos** (about $10 a month instead of $30–35 running 24/7). Interview log entry, 2026-11-12.
- **New owner rule (2026-11-12): the project stays fully free.** Never upgrade the plan, never activate advanced features.
- **Stage 4 checked in the owner's Chrome** (Claude in Chrome, read-only apart from the budget):
  - Free plan, $100 credits, 182 days left, ends **2027-05-12**, $0 spent.
  - Nothing created: 0 S3 buckets in any Region, no IAM users.
  - The account came from **AWS's new projects-based experience** (2026-09). Sign-in is through an identity provider into a project. IAM says people get access through the Team page; IAM users are for programs only. There are no user-group or alias pages.
  - **The project is locked to Sydney `ap-southeast-2`.** Opening EC2 in Mumbai showed: "Your project is assigned to Asia Pacific (Sydney) … upgrade your plan first, and then activate advanced features." The owner chose **Sydney**.
- **Budget `monthly-credit-burn`** created:
  - $15 a month, unblended cost.
  - Scope: Charge type **Excludes Credit, Refund**.
  - Email alerts at 33%, 66% and 100% actual, and 100% forecasted, to the owner's email (not in the repo).
  - No actions.
- **ADR 0030** (Sydney, new experience, budget without credits). It replaces ADR 0029. ADR 0011 has a dated Region note.
- Updated: runbook `docs/devops/aws-account.md` (rewritten), `PROGRESS.md` (stage 4 ticked, stage 5 notes), `architecture.md`, `DEVOPS_PLAN.md`, `CLAUDE.md`'s Stack line, `phase-1.md`, interview log (4 entries, 2 new questions, 4 glossary terms, Numbers).
- **PR #14** (`docs: check the aws account and record adr 0030`), branch `docs/devops-stage-4-check`. All five checks were green on the first commit; this end-session commit goes on the same PR.

**Half-done:**
- **PR #14** is open, not merged.
- The **"Set up a cost budget" credit activity** still showed "Not started" right after the budget was created. Check Console Home → Explore AWS (the list scrolls inside its own box).
- **Owner tasks:**
  - Click the AWS Budgets verification email.
  - Turn on 2-step verification on the identity used to sign in to AWS (Google, GitHub, Apple or Amazon).

**Next step:**
1. Owner: squash-merge PR #14 when green, then `git switch main`, `git pull`, `git branch -D docs/devops-stage-4-check`. Do the two owner tasks above.
2. Next session: `/start-session`, then **DevOps stage 5 (Terraform)**, in Sydney. Order:
   - Decide how the laptop's AWS CLI and Terraform sign in under the new experience. Check the console's "Agent Toolkit for AWS" and the installed CLI's sign-in command. IAM users only for programs, and with an ADR if one is needed. Remove the broken old `aws` in `Python311\Scripts` first.
   - Redo ADR 0011's cost estimate with **Sydney prices** in the Pricing Calculator, and state it before creating anything.
   - Check that this project can launch `t4g.small` and that RDS offers PostgreSQL 18 in Sydney.
   - Then remote state, network, server and database, using the real EC2 and RDS to do those two credit activities. Stop both after the session.
3. A small PR any time: the **dependency refresh** in PROGRESS.
4. **Owner decisions waiting** (in PROGRESS):
   - whether `entry_log`'s `id` and `created_at` become database-only (P1.4 e)
   - what a visitor may do in the public demo, and how it resets (P1.20)
   - whether a thin AI slice comes right after demo data v1 (end of step 3)

**Watch out for:**
- **AWS, one-way doors:**
  - Never click **"Upgrade plan"** or **"Activate advanced features"**. Advanced features appear on IAM's Root access management page and on the Region-lock dialog.
  - Never create or join an AWS Organization, and never set up Control Tower.
  - On the Free plan AWS can't charge the card; it closes the account when the credits or the 6 months run out (2027-05-12).
- **AWS, money:**
  - The project is free only while it runs little. State each resource's cost per hour and per month before `terraform apply`.
  - Stop EC2 and RDS after every session until stage 7's schedule exists. A stopped server still pays for its disk. RDS restarts itself after 7 days stopped.
  - Nothing that bills while idle: no NAT gateway, no load balancer, no spare Elastic IPs.
  - Budgets only warn; they can't stop anything on the Free plan. Stage 5 may add a budget action that stops EC2 (the first two action budgets are free).
- **AWS, Region:** `ap-southeast-2` everywhere: the provider, RDS, S3, SSM and the CLI default. Mumbai is unavailable. The extra latency from India hasn't been measured yet.
- **AWS, privacy:**
  - Console URLs contain the account ID. Never commit them, nor the sign-in URL or the owner's email.
  - The browser extension can't read `settings.aws.com` or `signin.aws.amazon.com`, so the owner reads those pages.
- **ADR 0029 is replaced.** Its IAM-user, `admins` group, alias and root-MFA steps don't apply to this account.
- **Credit activities, $20 each:**
  - Budget: done, not yet credited.
  - EC2 and RDS: with stage 5's real resources.
  - Lambda and Bedrock: tiny, priced first, deleted afterwards. Never Aurora.
- **Docker Desktop must be running** for the local gitleaks scan, as well as for `pnpm test`/`check`/`db:up`/`app:up`. It was off this session, so the PR's `secrets` check covered it.
- **Demo-first order (2026-11-10):** work PROGRESS's Phase 1 top to bottom. Keep these:
  - P1.3's signup creates the first branch.
  - Every route names its permission from P1.4 on.
  - P1.8's ledger leaves room for batches and serial numbers.
  - Stage 7 comes before P1.3 stores real data.
- **Checked facts not to rediscover:** pg-boss needs `createSchema: false`; images are `linux/arm64`; no SWC plugin; `crypto.argon2` exists; TypeScript stays `~6.0`; Drizzle stays 0.45.
- **Failure paths (2026-11-10 scan):**
  - Throw Nest `HttpException`s for client-visible answers. Never `logger.error(error)` with an object; use `describeError(error)`.
  - `createDatabase` listens on every connection.
  - `runProcess` owns `uncaughtException`/`unhandledRejection`.
  - Test "the database goes away" with a connection in use.
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
- **CI and git:**
  - Five required checks; the PR must be up to date with `main`.
  - Lowercase Conventional PR titles of at most 72 characters.
  - Never edit a migration that's on `main`.
  - After a squash merge use `git branch -D`.
  - Never write repo files with PowerShell `Set-Content`.
- **Deferred minors and carried-over notes:** see the 2026-11-10 handoff in git history (`git log -p docs/HANDOFF.md`) and the "From …" notes under each PROGRESS task.
