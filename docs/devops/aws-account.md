# AWS account: what we have and how to keep it free (DevOps stage 4)

Why each choice: ADR 0011 (Free plan, one server + RDS) and **ADR 0030** (new projects-based experience, Region Sydney, budget without credits). ADR 0029's IAM-user plan is replaced: the account we got has no place for it.

**The repo is public.** The account ID, the sign-in URL, the owner's email and every password stay out of it. Keep them in a password manager.

## The account (checked in the console, 2026-11-12)

| What | Value |
| --- | --- |
| Plan | **Free** ("Upgrade plan" button shown, not clicked) |
| Credits | $100, plus up to $100 from 5 activities (below) |
| Days | 182 left on 2026-11-12; AWS shows the end date **2027-05-12** |
| Sign-up experience | AWS's new projects-based one (2026-09): sign in with an identity provider into a project; settings at `settings.aws.com` (Projects, Team, Billing, Profile) |
| Region | **Asia Pacific (Sydney) `ap-southeast-2`**, assigned to the project. Other Regions need Paid + advanced features. |
| IAM users | none (IAM says people get access through the Team page; IAM users are for programs only) |
| Resources | none: 0 S3 buckets in any Region, $0 spent |
| Budget | `monthly-credit-burn`, created 2026-11-12 (below) |

## Rules that can't be undone

- **Never click "Upgrade plan" or "Activate advanced features".** Advanced features need the Paid plan and can't be turned off. On the Paid plan AWS can charge your card. On the Free plan it can't: it closes the account when the credits or the 6 months run out.
- **Don't create or join an AWS Organization**, or set up Control Tower.
- **One account, in your own name.** The Free plan and its credits are only for new AWS customers.

## How you sign in

- Through the identity you signed up with (Google, GitHub, Apple or Amazon), then the project. **MFA lives on that identity:** turn on 2-step verification there (for Google: myaccount.google.com → Security). That protects the AWS project too.
- Bookmark the console after signing in. Don't commit the URL; it contains the account ID.
- **Laptop (CLI and Terraform), ADR 0031:** `aws login --profile business-software` opens the browser; pick the project and session. Credentials last 12 hours and renew for 90 days. Always name the profile: the laptop has no `[default]` credentials on purpose, so a command without `--profile` fails instead of reaching another account.

## Keeping it free: the money guardrails

1. **The budget** (Billing and Cost Management → Budgets → `monthly-credit-burn`):
   - Monthly cost budget, **$15**, unblended cost.
   - Scope: *Filter specific AWS cost dimensions* → **Charge type → Excludes → Credit, Refund**. By default AWS counts credits as negative cost, so without this filter the budget would show $0 while the credits drain.
   - Email alerts at **33% (~$5), 66% (~$10), 100% actual**, and **100% forecasted**.
   - No actions. An alert-only budget is free. On the Free plan a budget can only warn; it can't stop anything.
   - **Owner:** AWS emails each new recipient a confirmation link. Click it, or no alert arrives.
2. **Stop the server and the database after every session** until stage 7's automatic schedule exists. A stopped server pays only for its disk; RDS restarts itself after 7 days stopped.
3. **Before Terraform creates anything**, Claude states its cost per hour and per month against the remaining credits.
4. Nothing that bills by the hour while idle: no NAT gateway, no load balancer, no extra Elastic IPs.
5. Target: about **$10 a month** (running only for sessions and demos), about $60 over the 6 months.

## Credit activities ($20 each, within the 6 months)

Console Home → Explore AWS widget → filter *Earn AWS credits*. Credits earned expire 12 months after sign-up.

| Activity | Status (2026-11-12) | Plan |
| --- | --- | --- |
| Set up a cost budget using AWS Budgets | Budget created; widget still "Not started" right after | Check next session. If it stays "Not started", open the activity from the widget and follow its own steps. |
| Launch an instance using EC2 | Not started | Stage 5: launch the real `t4g.small` (or the smallest allowed type) through Terraform. If the activity needs its own launch, use the smallest type and terminate it within the hour (a few cents). |
| Create an Aurora or RDS database | Not started | Stage 5: the real RDS instance (`db.t4g.micro`), stopped after the session. Never Aurora (costs more). |
| Create a web app using AWS Lambda | Not started | Later: a tiny function, deleted afterwards. Check its price first; it should cost cents at most. |
| Use a foundation model in the Amazon Bedrock playground | Not started | Later: one short prompt. Check the model's price per token first; it should cost under a cent. |

## Tools on the laptop

- AWS CLI v2 (2.40.0) and Terraform (1.17.1), installed 2026-11-12 with `winget install --id Amazon.AWSCLI` / `Hashicorp.Terraform`. Open a new terminal after installing so PATH is fresh.
- The old AWS CLI v1 launchers in Python's `Scripts` folder were deleted the same day.
- Prices and the server shape: ADR 0032. Terraform's plan: `docs/plans/2026-11-12-stage-5-terraform.md`.
