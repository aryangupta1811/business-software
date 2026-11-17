# 0033 — New AWS account: Free plan in Mumbai (`ap-south-1`), an admin IAM user with MFA, guardrails as code

- **Date:** 2026-11-17
- **Status:** Accepted

## Context

Signing in to the first account (ADR 0030) kept failing: it was opened with "Sign in with Google" through AWS's new projects-based experience. Nothing had been built there yet (only a hand-made budget; Terraform had never run), so on 2026-11-15 the owner decided to move to a new account before the first `apply` (plan `docs/plans/2026-11-15-aws-account-switch.md`). The owner opened it on 2026-11-17; whose account it is stays the owner's private matter.

Checked on 2026-11-17, read-only, in the console and with the CLI:

- **Plan:** `aws freetier get-account-plan-state` says `FREE`, `ACTIVE`, **$100.00 credits, ends 2027-05-17**. The plan's gate (stop on a Paid plan) passed.
- **Not a projects-based account.** The console opened in `us-west-2` with no project, and `ec2 describe-regions` shows Mumbai (`ap-south-1`) and Sydney as "opt-in-not-required"; calls in both work. ADR 0030's reason for Sydney (the project was locked there) doesn't apply.
- **Empty:** no instances, volumes, addresses, RDS instances, buckets, budgets or IAM users; only the default VPCs.
- **Both Regions** offer `t4g.small` (Free plan eligible), RDS PostgreSQL 18.6 on `db.t4g.micro` gp3, and Canonical's Ubuntu 26.04 ARM64 image.
- **Prices** (Pricing API): Mumbai **$0.0372 per running hour + $4.44 a month**; Sydney $0.0512 + $4.73 (full table in the switch plan).
- **Latency** from the laptop in India (TCP connect, 5 tries): **Mumbai 0.05–0.07 s, Sydney 0.29–0.32 s**.
- **Sign-in:** the CLI's first `aws login` landed on the **root user**, and root had **no MFA**.

NFR 5 (`product-overview.md`): a scanned item on screen in under 200 ms.

## Options considered

### Region

#### Mumbai `ap-south-1`
- Pros: about 5x lower latency from India; about 15–25% cheaper; the shops it serves are in India; available on the Free plan in this account.
- Cons: four Terraform lines and the docs change; ADR 0032's prices and checks must be redone (done above).

#### Stay in Sydney `ap-southeast-2`
- Pros: no edits.
- Cons: 0.3 s per round trip and higher cost, with nothing gained now that the account isn't locked.

#### Hyderabad `ap-south-2`
- Pros: also in India.
- Cons: an opt-in Region ("not-opted-in"), newer with fewer services; Mumbai has everything this project needs.

### How people and the CLI sign in

#### An admin IAM user with MFA, through `aws login` (chosen)
- Pros: root is locked away with MFA; daily work uses an identity that IAM can restrict and audit; `aws login` gives 12-hour credentials, so no access keys exist.
- Cons: one more identity to look after; `AdministratorAccess` is broad.

#### Keep using root
- Pros: nothing to set up.
- Cons: root can't be restricted by any policy, can close the account or upgrade the plan, and using it daily is the first thing a security review flags.

#### IAM Identity Center
- Pros: AWS's recommendation for organizations with many people or accounts.
- Cons: more setup for one person and one account; it brings in AWS Organizations, which ADR 0030 ruled out on the Free plan.

### The budget

#### As Terraform in the bootstrap root (chosen)
- Pros: a new account gets the same guardrail with one `apply`; reviewed like any other change.
- Cons: the alert address must stay out of the public repo (git-ignored `terraform.tfvars`).

#### By hand in the console, as in the first account
- Pros: quick once.
- Cons: the account switch showed the cost: every hand-made guardrail has to be remembered and redone.

### The Agent Toolkit for AWS (owner's request, 2026-11-17)

#### Installed, MCP server read-only (chosen)
- Pros: current AWS docs and AWS's skills in every session; the agent can read but can't change the account, so changes still go through Terraform with a plan, a price and the owner's OK.
- Cons: the agent's MCP tools can't list resources in the account (read-only hides the general API tool); reads use the AWS CLI.

#### Installed with write access
- Cons: a second path to change AWS that bypasses Terraform's plan and the owner's approval.

#### Not installed
- Cons: no current docs or AWS skills; the agent relies on training data for fast-moving services.

## Decision

The project moves to the **new account, on the Free plan, in Mumbai `ap-south-1`**. ADR 0030's rules carry over unchanged: **never click "Upgrade plan" or "Activate advanced features"**, never create an AWS Organization, keep the account ID out of the repo.

- **Root** has MFA and is used only for billing and emergencies.
- **One IAM user** with `AdministratorAccess`, a console password, MFA, and **no access keys** does the daily work. The laptop signs in with `aws login --profile business-software` as that user (ADR 0031's method, unchanged). The user's name is not written in the repo.
- **Guardrails are code** in `infra/terraform/bootstrap/`: the account lock (`allowed_account_ids`, git-ignored `terraform.tfvars`) and the budget `monthly-credit-burn` ($15 a month, credits and refunds excluded, alerts at 33/66/100% actual and 100% forecast, address in `terraform.tfvars`). Applied on 2026-11-17 together with the state bucket; the bootstrap root's state then moved into the bucket.
- **Agent Toolkit for AWS** with a **read-only** MCP server and AWS's rules under this project's overrides (`docs/devops/aws-agent-rules.md`; laptop details in `docs/devops/aws-account.md`).
- **The old account** is left as it is: Free plan, only its budget, profile renamed `business-software-old`. AWS closes it at the end of its Free period (2027-05-12); the owner may close it earlier.

## Why

The new account removes the constraint that forced Sydney, and Mumbai is better on every measure that matters here: latency for a billing screen in India, cost against fixed credits, and data staying in India. The root-plus-IAM-user model is the standard one for a single owner and is now possible (the projects-based account had no IAM users for people). Guardrails written as code survive the next account change; ones made by hand don't.

## Consequences

- **ADR 0030 is replaced.** Its Free plan rules live on here. This model is close to ADR 0029's (root locked away, IAM user with MFA), which ADR 0030 had replaced only because the projects-based account had no place for it.
- **ADR 0031** keeps its method; its Region and the identity behind `aws login` change (dated note there).
- **ADR 0032** keeps the server shape; the prices and latency change (dated note there). **ADR 0011:** 24/7 costs about $31.60 a month in Mumbai, not $42 (dated note there).
- **Credits and dates** reset: $100, ending 2027-05-17. All five $20 credit activities can be done again in this account.
- **P1.13:** with ~0.06 s per round trip a server lookup per scan becomes possible within NFR 5, but the browser-side catalogue copy planned in ADR 0032 is still the safer design; P1.13 decides.
- **This network breaks IPv6 at the TLS step**, which affected Terraform provider downloads, docs fetches and the MCP proxy. Workarounds are in `docs/devops/aws-account.md`; the real fix is on the router or with the ISP.
- `AdministratorAccess` on the IAM user is a deliberate shortcut for a one-person account; stage 10 (security review) revisits least privilege.
- The owner confirms the budget's subscription email, or no alert arrives.

## Interview note

My first AWS account had sign-in problems, and because nothing was built yet I moved to a new one, checked its plan through the Free Tier API before creating anything, and found it wasn't locked to Sydney like the first, so I compared Regions: Mumbai was five times faster from India and about a quarter cheaper, and Terraform made the move a four-line change. I locked root away with MFA and work as an IAM user whose CLI credentials come from `aws login`, so there are no access keys anywhere. The lesson I took from redoing a hand-made budget is that guardrails are infrastructure too, so the budget and the account lock are now Terraform.
