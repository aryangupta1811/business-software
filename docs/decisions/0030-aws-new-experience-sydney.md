# 0030 — AWS account: the new projects-based Free plan, Region Sydney (`ap-southeast-2`), a budget that leaves out credits

- **Date:** 2026-11-12
- **Status:** Accepted

## Context

The owner opened the AWS account (DevOps stage 4) around 2026-11-12. AWS shows **$100 of credits, 182 days left, ending 2027-05-12**, and $0 spent. The account was checked together in the console on 2026-11-12 (read-only, except for the budget below).

The account came out of **AWS's new getting-started experience** (announced 2026-09-16 and rolled out gradually to new customers). It doesn't match ADR 0029 or the runbook written for it:

- You sign in with an existing identity (Google, GitHub, Apple or Amazon) into a **project**. AWS settings live at `settings.aws.com` (Projects, Team, Billing, Profile).
- IAM shows **no IAM users**, and a banner says IAM users are only for programmatic access; people get access through the Team page. There are no User groups or account-alias pages. There *is* a service-linked role for AWS Organizations: AWS manages the structure behind the project.
- **The project is locked to one Region, Asia Pacific (Sydney) `ap-southeast-2`.** Opening EC2 in Mumbai showed: "Your project is assigned to Asia Pacific (Sydney) ap-southeast-2 … To access other commercial AWS Regions, upgrade your plan first, and then activate advanced features."
- **"Activate advanced features"** appears in IAM (Root access management) and on that Region dialog. AWS's announcement says advanced features are needed for "multiple Regions". Other pages say they need the Paid plan and can't be turned off again.
- **Spend limits** (a hard monthly cap that pauses the project) exist only on the Paid plan.
- On the Free plan nothing can be charged to the card. When the credits or the 6 months run out, AWS closes the account.
- AWS Budgets counts credits as negative cost by default, so an ordinary budget shows $0 while the credits drain.

ADR 0011 chose **Mumbai** "close to Indian users". The owner's rule is that the project stays **fully free**.

## Options considered

### Option A — Stay in Sydney, the project's assigned Region (chosen)
- Pros: free, and works today. Everything stays on the Free plan, with no card charges possible. RDS, EC2, S3 and SSM are regional services available in Sydney.
- Cons: every request from India travels to Australia and back. That's roughly 0.1–0.15 s more per API call (an estimate, to measure in stage 5). Sydney's prices are likely a little higher than Mumbai's (to check in the AWS Pricing Calculator before stage 5 creates anything). Data sits outside India: acceptable for a demo with seeded data, but a real shop's data would need a Region decision first.

### Option B — Create another project and try to put it in Mumbai
- Pros: the Region ADR 0011 wanted, if the Free plan allows it.
- Cons: not known to be allowed; the Region seems to be assigned, not chosen. It costs the owner a detour for an uncertain result. The credits are shared anyway.

### Option C — Upgrade to the Paid plan and activate advanced features for Mumbai
- Pros: any Region; spend limits become available.
- Cons: can't be undone, and the card can then be charged. That breaks the owner's "fully free" rule and ADR 0011's ₹0 budget.

## Decision

Option A. The project's Region is **Asia Pacific (Sydney) `ap-southeast-2`**, everywhere: Terraform's provider, the RDS instance, the backup bucket, SSM parameters and the CLI's default. The account stays on the **Free plan**. **Never click "Upgrade plan" or "Activate advanced features"**, and don't create an AWS Organization.

How people sign in follows the new experience: the owner signs in through the identity they signed up with, and MFA is set on that identity. ADR 0029's IAM user, `admins` group, account alias and root-MFA steps don't apply, because this account has no place for them. **IAM users exist only for programmatic access**: if stage 5 can't get short-lived CLI credentials any other way, it decides that in its own ADR.

Spending is watched by one AWS Budget, `monthly-credit-burn`, created on 2026-11-12. It's a monthly cost budget of $15 (unblended), with a filter that **excludes the charge types Credit and Refund**, so it measures what the resources really cost before credits. It emails the owner at 33% (~$5), 66% (~$10) and 100% of actual cost, and at 100% of forecasted cost. It has no actions, and alert-only budgets are free. It's also one of the five $20 credit activities.

## Why

The owner's top cloud rule is "fully free". The Free plan is the only state in which AWS can't charge the card, and leaving Sydney requires leaving the Free plan. Latency to Australia slows a demo a little but breaks nothing. Losing the Free plan guarantee can't be reversed.

## Consequences

- **ADR 0029 is replaced** by this ADR. Its rule "don't turn on AWS Organizations" survives in this stronger form: never upgrade, never activate advanced features.
- **ADR 0011** keeps its design (one EC2 server, RDS, S3, Terraform). Only the Region changes, noted there with a date. Stage 5 must check, before creating anything:
  - Sydney's prices for `t4g.small`, `db.t4g.micro`, gp3 storage and a public IPv4 address, against the remaining credits.
  - That `t4g.small` can be launched in this project (ADR 0011's 2026-11-10 note listed the Free plan's six instance types).
  - That RDS offers PostgreSQL 18 in Sydney.
- `docs/architecture.md`, `docs/devops/DEVOPS_PLAN.md` and the runbook `docs/devops/aws-account.md` now say Sydney.
- The budget alerts measure gross cost, so an alert means real resources are running. AWS itself emails as the credits or the 6 months run low.
- Stage 5 decides how the laptop's CLI and Terraform sign in (the console's "Agent Toolkit for AWS" and the CLI's sign-in command are the first things to check). CI keeps OIDC (ADR 0012).
- A budget can only warn on the Free plan, not stop. "Stop the server and database after each session" (stage 5 until stage 7's schedule) stays a rule. Stage 5 may add a budget action that stops EC2 (the first two action budgets are free).
- The account ID, the sign-in URL and the owner's email are never committed (`CLAUDE.md` rule 11).

## Interview note

My AWS account came from AWS's new sign-up flow. It locks a Free plan project to one Region, Sydney, and needs a Paid plan plus "advanced features", which can't be undone, to use Mumbai. My budget is zero, so I kept the Free plan and accepted about a tenth of a second more per request, which a demo can live with, and I wrote down that real shop data would need the Region question reopened. I also learned that AWS Budgets subtracts credits by default, so I filtered credits out; otherwise my alert would have stayed at $0 while my credits drained.
