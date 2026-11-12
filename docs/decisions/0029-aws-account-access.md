# 0029 — AWS account access: root locked away, an IAM user with MFA, no AWS Organizations on the Free plan

- **Date:** 2026-11-02
- **Status:** Replaced by 0030 (2026-11-12: the account came from AWS's new projects-based experience, which has no IAM users for people, no account alias and a Region lock; the "never join Organizations" rule survives in 0030 as "never upgrade, never activate advanced features")

## Context

DevOps stage 4 (`docs/devops/DEVOPS_PLAN.md`) opens the AWS account chosen in ADR 0011: a **Free plan** account in Mumbai (`ap-south-1`), with up to $200 of credits over 6 months and no charges unless it's upgraded to the Paid plan. The owner reported on 2026-11-02 that placement season is close, so the account opens now.

The plan in `PROGRESS.md` (and the interview log, 2026-10-29) was to sign in through **IAM Identity Center** (single sign-on). Before writing the steps, we read AWS's page *Choosing a plan* (docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html, read 2026-11-02):

> "Free account plans will automatically upgrade to paid plan if you join AWS Organizations, set up an AWS Control Tower landing zone, …"

Identity Center's usual setup (an *organization instance*, the only kind that can give access to AWS accounts) turns on AWS Organizations. The page says "join", not "create", so it's unclear whether creating your own organization counts, and we won't test that with a real account. An upgrade can't be undone, and on the Paid plan real money can be charged.

The Free Tier FAQ (aws.amazon.com/free/free-tier-faqs/, read 2026-11-02) also says the Free plan and its credits are only for new AWS customers: you're ineligible "if you have an existing AWS account or have previously had one." So there is one account, opened once, in the owner's own name.

## Options considered

### Option A — IAM Identity Center (organization instance), as planned
- Pros: the modern standard; short-lived credentials for the console and the CLI (`aws sso login`); scales to many accounts and people.
- Cons: needs AWS Organizations, which upgrades a Free plan account to Paid (or at least risks it). That loses the "no charges" guarantee that ADR 0011's ₹0 budget relies on.

### Option B — Use the root user for everything
- Pros: nothing to set up.
- Cons: root can do anything (including closing the account) and can't be limited by any policy. A leaked root password or key is the worst possible leak. AWS's own guidance is to use it only for the few tasks that need it.

### Option C — Root locked away; everyday work as an IAM user with MFA (chosen)
- Pros: works on the Free plan without Organizations. MFA on both logins. The root user is used only for account-level tasks. Teaches the IAM basics (users, groups, policies) that interviews ask about.
- Cons: an IAM user is a long-lived identity in one account. It doesn't scale to many accounts the way Identity Center does. Its permissions (`AdministratorAccess` for now) are broad.

## Decision

Option C. The root user gets MFA, no access keys, and is used only for account-level tasks. Daily work happens as one IAM user, in a group `admins` with the AWS managed policy `AdministratorAccess`, with MFA and a console password. Billing information is opened to IAM users so this login can see the credit balance. The default Region is `ap-south-1`. **Don't turn on AWS Organizations, Control Tower or Identity Center's organization instance** while the account is on the Free plan. Steps: `docs/devops/aws-account.md`.

**Not decided yet (stage 5):** how the laptop's `aws` and `terraform` get credentials. The rule stays the same as before: short-lived credentials, no long-lived access keys on disk unless there's no other way. Candidates to check against the CLI version installed then: the CLI's own console-based sign-in command, or an IAM role assumed with MFA. CI keeps OIDC (ADR 0012), which doesn't need Organizations.

## Why

The ₹0 budget (ADR 0011) depends on staying on the Free plan, and the Organizations rule is the one documented way to leave it by accident. An IAM user with MFA covers stage 4's goals (no root use, MFA everywhere) without that risk.

## Consequences

- PROGRESS's "IAM Identity Center" for stage 4 is replaced by this ADR. The 2026-10-29 interview log entry about `aws sso login` describes the old plan. The new entry explains the change.
- `AdministratorAccess` is wider than needed. Stage 10 (security review) narrows it, and Terraform's role in stage 5 gets only what it needs.
- If the account ever moves to the Paid plan (for example, to keep the demo running after the 6 months, ADR 0011), Identity Center becomes possible. Revisit this ADR then.
- The account ID, the sign-in alias and the root email are never committed (the repo is public, `CLAUDE.md` rule 11).

## Interview note

The plan was single sign-on through IAM Identity Center. But AWS's Free plan page says joining AWS Organizations upgrades the account to Paid, and my budget is zero. So I locked the root user away with MFA and work as an IAM user with MFA in an admin group, and I'll narrow its permissions in the security review. In a company with many accounts I'd use Identity Center. Here, reading the plan's rules first saved me from an upgrade I couldn't undo.
