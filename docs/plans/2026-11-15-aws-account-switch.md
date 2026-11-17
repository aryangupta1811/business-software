# Move the project to a new AWS account: plan

> **Status:** done 2026-11-17 (session 21), except step 7 (winding down the old account), which the owner skipped: it holds only a free budget and can't bill on the Free plan. Result: ADR 0033. The new account is on the Free plan in **Mumbai**; root has MFA, an admin IAM user with MFA does the work; the account lock, the budget and the state bucket exist, built by Terraform. Proposed 2026-11-15; the owner went through it step by step on 2026-11-17.

## Owner's answers (2026-11-15)

- **Why:** signing in to the current project has become difficult (sign-in problems), so the owner will open a new one and start from there. It isn't about the Region or the credits.
- **Not created yet.** The owner will do it later; the session ended here.
- **Answered 2026-11-17 (session 21):**
  - The old account was opened with "Sign in with Google", and that sign-in is what keeps failing. So the fix is a new account, not a new project under the same sign-in.
  - The new account is open. Whose it is stays the owner's private matter; it isn't asked again or written down.
  - The old account: the owner first asked for a cleanup prompt (written, for a separate Claude Code session), then chose to **skip the cleanup** and start with the new account. The old account holds only the budget, which costs nothing, and a Free plan account can't charge the card; AWS closes it at the end of its Free period. Step 7 stays optional.
  - Step 3's Free plan check still runs on the new account before anything is created.
- **New account, first look in the console (Claude, read-only, 2026-11-17):** Billing → Free Tier says "Your free plan account does not get charged": **Free plan, $100.00 credits remaining, free access ends 2027-05-17**. Month-to-date cost: no data. The console opened in `us-west-2` (Oregon), not a project locked to Sydney, so this account may come from the classic sign-up rather than the projects-based experience. Which Regions it may use (Mumbai?) is checked with the CLI in step 3. The page also shows an "Upgrade plan" link: never click it.
- **Step 2 done (2026-11-17):** old profile renamed to `business-software-old` (backup `~/.aws/config.bak-2026-11-17`); the owner ran `aws login --profile business-software`. `sts get-caller-identity`: the new account (last 4 digits differ from the old one), **signed in as the root user** (`arn:aws:iam::<account>:root`).
- **Step 3 results (2026-11-17, CLI, read-only):**
  - `freetier get-account-plan-state`: `FREE`, `ACTIVE`, $100.00 credits, ends 2027-05-17. **Gate passed.**
  - Regions: `ap-south-1` (Mumbai) and `ap-southeast-2` (Sydney) both "opt-in-not-required"; calls in both work. **This account is not locked to Sydney.**
  - Empty in both: 0 instances, volumes, addresses, RDS instances; only the default VPC. Global: 0 S3 buckets, 0 budgets, 0 IAM users, no root access keys. **Root MFA: off** (`AccountMFAEnabled` 0).
  - Both Regions: `t4g.small` offered and Free plan eligible (with `t4g.micro`, `t3.micro/small`, `t8i.micro/small`, `c7i-flex.large`, `m7i-flex.large`); RDS PostgreSQL 18.1–18.6 on `db.t4g.micro` gp3; Ubuntu 26.04 ARM64 image in Canonical's SSM parameter.
  - Prices (Pricing API, on-demand):

    | | Mumbai | Sydney |
    | --- | --- | --- |
    | EC2 `t4g.small` | $0.0112/h | $0.0212/h |
    | Public IPv4 | $0.005/h | $0.005/h |
    | RDS `db.t4g.micro` PostgreSQL Single-AZ | $0.021/h | $0.025/h |
    | EBS gp3 | $0.0912/GB-month | $0.096/GB-month |
    | RDS gp3 | $0.131/GB-month | $0.138/GB-month |
    | S3 Standard | $0.025/GB-month | $0.025/GB-month |
    | **Per running hour + per month (20 GB each)** | **$0.0372/h + $4.44** | **$0.0512/h + $4.73** |
    | ~60 h a month | ≈ $6.70 | ≈ $7.80 |
    | 24/7 | ≈ $31.60 | ≈ $42.10 |
  - Latency from the laptop (TCP connect to `ec2.<region>.amazonaws.com`, 5 tries): **Mumbai 0.05–0.07 s, Sydney 0.29–0.32 s**.
- **Step 4, owner's decisions (2026-11-17):**
  - **Region: Mumbai `ap-south-1`.** Replaces ADR 0030's Sydney choice (ADR 0033). Change the Region in the 4 Terraform/profile places; ADR 0032's prices get a dated note with the Mumbai table above.
  - **Sign-in: an admin IAM user, not root.** Owner turns on MFA for root, creates one IAM user with `AdministratorAccess`, a console password and MFA, and runs `aws login` as that user. No access keys. Root is kept for billing and emergencies. This replaces ADR 0031's `AccountFullAccessRole` (that role belonged to the projects-based experience), in ADR 0033; least privilege is revisited at stage 10.
- **Was open on 2026-11-15:**
  - What exactly fails at sign-in (the identity provider, the console, or `aws login`)? On 2026-11-15 the laptop's `aws login` session had only expired after its 12 hours, which is normal. If the identity itself is the problem, a new *project* under the same sign-in won't fix it; it needs a new account under another identity.
  - Account or project (question 2 below), and what happens to the old one (question 3).
  - The Free plan caution in question 1 stands: check the plan before creating anything (step 4's gate).

## Goal

**Goal:** everything this project creates in AWS lands in a **new account**, and nothing can reach the current one by accident. Then stage 5 part 2 continues where it stopped.

**Why now is the cheapest moment:** the current account holds one thing, the budget `monthly-credit-burn`. Terraform has never run against it: no state bucket, no `terraform.tfvars`, no `backend.hcl`, no state file. GitHub holds nothing about AWS yet (the OIDC role is stage 6). After `terraform apply`, a switch would mean rebuilding everything and moving a database.

## What is tied to the current account today (checked 2026-11-15)

| Where | What | Changes? |
| --- | --- | --- |
| AWS, current account | Budget `monthly-credit-burn` | Recreate in the new account; delete the old one (step 7) |
| Laptop, `~/.aws/config` | Profile `business-software`: Region `ap-southeast-2` and a `login_session` line naming the current account | Re-point to the new account (step 2) |
| Laptop, `~/.aws/login/` | Cached 12-hour credentials (expired) | Replaced by the new sign-in |
| Repo, Terraform (`infra/terraform/`, commit `787e09d`, not pushed) | No account ID anywhere. The bucket name is built from the signed-in account's ID. The Region `ap-southeast-2` is written in 4 files | Only if the new account's Region differs |
| Repo, docs | Account facts (plan, $100 credits, end date 2027-05-12, Sydney, role name) in `aws-account.md`, ADRs 0030–0032, PROGRESS, HANDOFF, DEVOPS_PLAN, the interview log | Updated in step 6 |
| GitHub | Nothing | No |
| `.env`, Docker Compose, the app's code | Nothing | No |

## Owner answers needed (before step 1)

1. **Why the new account, and whose is it?** The answer changes the plan:
   - *A different Region (Mumbai)?* A new sign-up may get Sydney again: the new experience assigns the Region (ADR 0030).
   - *More credits or a fresh 6 months?* AWS gives the Free plan and its credits to new customers only: you're ineligible "if you have an existing AWS account or have previously had one" (Free Tier FAQ, quoted in ADR 0029). A second account of your own can come out on the **Paid plan**, where the card can be charged, and opening accounts to collect credits again breaks AWS's terms.
   - *Another identity, a college or company account, someone else's?* Then who pays, who owns the data, and whose name is on it need writing down.
2. **Is it a new account or a new project?** In the new experience, `settings.aws.com` → Projects can add a project under the same sign-in. That shares the same credits and the same 6 months.
3. **The old account afterwards:** leave it empty until AWS closes it, or close it yourself (step 7).

## Steps

### Step 1 — Owner: open the new account (Claude gives the steps, doesn't do them)

Passwords, the card and the verification code are yours to type. While signing up:
- Use an identity with 2-step verification on.
- **Never click "Upgrade plan" or "Activate advanced features"**; don't create an Organization.
- Note three things from the console: the plan (Free or Paid), the credits and end date, and the Region the project is assigned to.
- Keep the account ID in the password manager. It never goes in the repo or the chat unmasked.

### Step 2 — Re-point the laptop's sign-in (Claude, with the owner at the browser)

The profile keeps its name, `business-software`, so no command, doc or Terraform file changes.

1. Rename the current profile in `~/.aws/config` to `business-software-old` (owner's OK: it's a config file outside the repo). It keeps access to the old account for step 7.
2. Owner: sign out of the old account in the browser, or the next command silently picks it again.
3. Owner: `aws login --profile business-software`, choose the **new** account, set the Region.
4. Claude: `aws sts get-caller-identity --profile business-software`, account ID masked. It must differ from the old one (compare the last 4 digits only).

### Step 3 — Read the new account's facts (Claude, read-only)

| Check | Command (always `--profile business-software`) |
| --- | --- |
| Plan, credits left, end date | `aws freetier get-account-plan-state` |
| Region the account may use | `ec2 describe-regions`, plus a call in another Region to see whether it's refused |
| Role behind the sign-in | `sts get-caller-identity` |
| Account is empty | S3 buckets, EC2 instances, RDS instances, budgets |
| Server types on the Free plan | `ec2 describe-instance-types --filters Name=free-tier-eligible,Values=true` |
| PostgreSQL 18.6 on `db.t4g.micro`, gp3 | `rds describe-orderable-db-instance-options` |
| Ubuntu 26.04 ARM64 image | Canonical's public SSM parameter |
| Only if the Region isn't Sydney: prices and latency | Pricing API (`--region us-east-1`), TCP connect time |

### Step 4 — Decision gate (owner), recorded as ADR 0033

| What step 3 shows | What happens |
| --- | --- |
| **Free plan, Sydney** | Smallest change. Code stays as it is. Only the account facts change (credits, end date). |
| **Free plan, another Region** | Change the Region in 4 Terraform files and the profile. Redo ADR 0032's price table and its three checks for that Region. ADR 0030's Region decision is replaced by ADR 0033. |
| **Paid plan** | **Stop.** The "AWS can't charge the card" guarantee (ADR 0030) is gone. Continue only if the owner says so in words, and then with a spend limit (Paid-only feature) set before anything is created. |

### Step 5 — Guardrails in the new account, before any resource

1. **Account guard:** create `infra/terraform/bootstrap/terraform.tfvars` and `infra/terraform/demo/terraform.tfvars` (git-ignored) with `allowed_account_ids` = the **new** ID only. Terraform then refuses any other account, whatever the laptop is signed in to.
2. **Budget:** recreate `monthly-credit-burn` ($15 a month, charge types Credit and Refund excluded, alerts at 33%, 66%, 100% actual and 100% forecast).
   - Recommended: as Terraform in the bootstrap root, with the alert email in the git-ignored `terraform.tfvars`. A second hand-built budget is the reason for doing it in code.
   - Owner: click the confirmation link AWS emails, or no alert arrives.
3. Owner: 2-step verification on the new identity.

### Step 6 — Update the files (branch `docs/aws-account-switch`, its own PR, merged before stage 5 continues)

- **ADR 0033** (new): why the account changed, what step 3 found, the gate's result.
- **Dated notes, not rewrites**, on ADRs 0011, 0030, 0031, 0032: history stays readable.
- `docs/devops/aws-account.md`: the account table, the credit activities (all five restart), a new section "Switching accounts" with steps 2–5.
- `docs/PROGRESS.md`, `docs/HANDOFF.md`, `docs/devops/DEVOPS_PLAN.md`; `CLAUDE.md` and `docs/architecture.md` only if the Region or plan changed.
- `docs/plans/2026-11-12-stage-5-terraform.md`: status "approved 2026-11-15", and the account note.
- `docs/journal/INTERVIEW_LOG.md`: the decision, the concept (why infrastructure as code made the switch cheap; the account guard), the gotchas (browser session picks the account; credits are per customer), Numbers.
- Old dated entries (interview log, older plans) stay as written.

### Step 7 — Wind down the old account (after the new one has a working `terraform apply`)

- Claude, with the owner's OK: delete the old budget through `business-software-old`, then remove that profile and its cached login.
- Owner's choice: leave the empty account (nothing in it can bill; AWS closes it when its Free period ends) or close it in the console. Closing can't be undone, and it's the owner's click.
- Still open from session 19: deactivate and delete the other project's old access key (`~/.aws/credentials`).

### Step 8 — Continue stage 5 part 2

On a new branch from `main` (the Terraform files are already there, written and validated on 2026-11-15, never applied): apply the Region change if step 4 asked for one, then pick up at "plan the bootstrap bucket, state the cost, wait for OK".

## Watch out for

- **Which account am I in?** Before every `plan` and `apply`: `sts get-caller-identity`, masked. Three layers protect a mix-up: the named profile, `allowed_account_ids`, and a bucket name that contains the account ID.
- **Two account IDs to keep private now.** Mask both (`sed -E 's/[0-9]{12}/<account>/g'`); never paste either into a doc.
- **Don't run resources in both accounts.** The old one stays empty from here on.
- **Credits and the 6 months are per account**, so every date and dollar figure in the docs changes; the nightly-stop and stop-after-session rules don't.
- **Nothing is deleted or closed** without the owner's explicit OK (`CLAUDE.md` rule 7).

## Cost and time

$0 in AWS. About half a session: steps 1–2 need the owner at the browser (10–15 minutes), steps 3–6 are Claude's.
