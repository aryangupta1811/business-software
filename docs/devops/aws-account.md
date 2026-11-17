# AWS account: what we have and how to keep it free (DevOps stage 4)

Why each choice: ADR 0011 (Free plan, one server + RDS) and **ADR 0033** (new account in Mumbai, admin IAM user, guardrails as code; it replaces ADR 0030, the first account). Sign-in method: ADR 0031.

**The repo is public.** The account ID, the sign-in URL, the IAM user's name, the owner's email and every password stay out of it. Keep them in a password manager.

## The account (checked 2026-11-17)

| What | Value |
| --- | --- |
| Plan | **Free**, `ACTIVE` (`aws freetier get-account-plan-state`; the console's "Upgrade plan" link is never clicked) |
| Credits | $100, plus up to $100 from 5 activities (below) |
| Ends | **2027-05-17** |
| Sign-up | The standard sign-up, not the projects-based one: no project, any Region allowed |
| Region | **Asia Pacific (Mumbai) `ap-south-1`** for everything the project builds |
| People | Root (MFA on, billing and emergencies only) and **one IAM user** with `AdministratorAccess`, a console password and MFA, **no access keys** |
| Built so far | By Terraform on 2026-11-17 (`infra/terraform/bootstrap/`): the state bucket and the budget |

The first account (projects-based, Sydney, "Sign in with Google") is left as it is: Free plan, only its hand-made budget. AWS closes it at the end of its Free period (2027-05-12). Its CLI profile is `business-software-old`.

## Rules that can't be undone

- **Never click "Upgrade plan" or "Activate advanced features".** On the Paid plan AWS can charge your card. On the Free plan it can't: it closes the account when the credits or the 6 months run out.
- **Don't create or join an AWS Organization**, or set up Control Tower.
- **Closing an account** can't be undone, and it's the owner's click.

## How you sign in

- **Console:** the IAM user, through the account's sign-in URL (in the password manager), with MFA. Root only for billing or if the IAM user is locked out.
- **Laptop (CLI and Terraform), ADR 0031:** `aws login --profile business-software --region ap-south-1`, approved in the browser **as the IAM user**. `aws login` reuses whoever the browser is signed in as: sign out of root first. Credentials last 12 hours and renew for 90 days. Always name the profile: `[default]` belongs to another project.
- **Check before every `plan` and `apply`:** `aws sts get-caller-identity --profile business-software` shows `user/…`, not `root`, in the new account (mask the ID: `sed -E 's/[0-9]{12}/<account>/g'`).

## Keeping it free: the money guardrails

1. **The budget `monthly-credit-burn`**, as Terraform in `infra/terraform/bootstrap/budget.tf`:
   - Monthly cost budget, **$15**, with **credits and refunds left out**. By default AWS counts credits as negative cost, so the budget would show $0 while the credits drain.
   - Email alerts at **33% (~$5), 66% (~$10), 100% actual**, and **100% forecasted**. The address is in the git-ignored `terraform.tfvars`.
   - No actions. An alert-only budget is free. On the Free plan a budget can only warn; it can't stop anything.
   - **Owner:** AWS emails each new recipient a confirmation link. Click it, or no alert arrives.
2. **The account lock:** `allowed_account_ids` in each root's git-ignored `terraform.tfvars`. Terraform refuses any other account, whatever the laptop is signed in to.
3. **Stop the server and the database after every session** until stage 7's automatic schedule exists. A stopped server pays only for its disk; RDS restarts itself after 7 days stopped.
4. **Before Terraform creates anything**, Claude states its cost per hour and per month against the remaining credits (Mumbai: ADR 0032's dated note, $0.0372 per running hour + $4.44 a month).
5. Nothing that bills by the hour while idle: no NAT gateway, no load balancer, no Elastic IP, no interface VPC endpoint, no Secrets Manager.
6. Target: under **$10 a month** (running only for sessions and demos).

## Switching accounts (done once, 2026-11-17; `docs/plans/2026-11-15-aws-account-switch.md`)

1. Rename the old profile in `~/.aws/config` (e.g. `business-software-old`), so the name `business-software` is free.
2. Sign out of the old account in the browser, then `aws login --profile business-software --region <region>`.
3. Read the facts before creating anything: `aws freetier get-account-plan-state` (**stop if it isn't `FREE`**), Regions, an empty account, the instance type, the database engine version, the server image.
4. Root MFA, the IAM user with MFA, `aws login` again as that user.
5. Put the new account ID in both roots' `terraform.tfvars`, the alert address in the bootstrap one. Comment out the bootstrap backend block, `apply` the bootstrap root, write `infra/terraform/backend.hcl`, uncomment the block, `terraform init -migrate-state -backend-config=../backend.hcl`, and check that a `plan` shows no changes.

## Credit activities ($20 each, within the 6 months)

Console Home → Explore AWS widget → filter *Earn AWS credits*. All five start over in the new account. Credits earned expire 12 months after sign-up.

| Activity | Status (2026-11-17) | Plan |
| --- | --- | --- |
| Set up a cost budget using AWS Budgets | Budget created by Terraform | Check the widget. If it stays "Not started", open the activity from the widget and follow its own steps. |
| Launch an instance using EC2 | Not started | Stage 5: the real `t4g.small` through Terraform. If the activity needs its own launch, use the smallest type and terminate it within the hour (a few cents). |
| Create an Aurora or RDS database | Not started | Stage 5: the real RDS instance (`db.t4g.micro`), stopped after the session. Never Aurora (costs more). |
| Create a web app using AWS Lambda | Not started | Later: a tiny function, deleted afterwards. Check its price first; it should cost cents at most. |
| Use a foundation model in the Amazon Bedrock playground | Not started | Later: one short prompt. Check the model's price per token first; it should cost under a cent. |

## Tools on the laptop

- AWS CLI v2 (2.40.0) and Terraform (1.17.1), installed 2026-11-12 with `winget install --id Amazon.AWSCLI` / `Hashicorp.Terraform`. Open a new terminal after installing so PATH is fresh.
- The old AWS CLI v1 launchers in Python's `Scripts` folder were deleted the same day.
- Prices and the server shape: ADR 0032. Terraform's plan: `docs/plans/2026-11-12-stage-5-terraform.md`.
- **Agent Toolkit for AWS** (2026-11-17): `uv` 0.13.8 (`winget install --id astral-sh.uv`), then `aws configure agent-toolkit --yes --region us-east-1 --profile business-software`. It installed 25 AWS skills into `~/.claude/skills` (and `~/.agents/skills` for Codex) and an `aws-mcp` server in `~/.claude.json` (and the Gemini CLI's settings, left as generated). Free: only the AWS calls it makes are billed. Rules: `docs/devops/aws-agent-rules.md`.
  - The generated `aws-mcp` entry was replaced (`claude mcp add-json aws-mcp -s user …`) with: `uvx --from mcp-proxy-for-aws==1.8.0 python ~/.aws-mcp/run_ipv4.py https://aws-mcp.us-east-1.api.aws/mcp --profile business-software --read-only --disable-telemetry --metadata AWS_REGION=ap-south-1 INSTALL_SOURCE=aws-cli`, with `uvx` by its full winget path (`%LOCALAPPDATA%\Microsoft\WinGet\Packages\astral-sh.uv_…\uvx.exe`).
  - Why `python …` and not the tool's own command: Windows Application Control blocks the unsigned `.exe` launcher uv makes for each tool ("An Application Control policy has blocked this file").
  - Why `run_ipv4.py` (a 15-line wrapper, outside the repo): this network breaks IPv6 at the TLS step, and the proxy's async HTTP stack tries IPv6 first whatever Windows prefers. The wrapper limits the proxy's name lookups to IPv4, then runs `mcp_proxy_for_aws.server`. Remove it once IPv6 works on the network.
  - Windows also prefers IPv4 now (owner, admin PowerShell, 2026-11-17): `netsh interface ipv6 set prefixpolicy ::ffff:0:0/96 60 4`. Undo: `… 35 4`.
  - Check: `claude mcp list` shows `aws-mcp … ✔ Connected`; read-only exposes six tools (docs search and read, skills, Regions, regional availability, tasks).
