# 0031 — Laptop sign-in for the AWS CLI and Terraform: `aws login` with a named profile

- **Date:** 2026-11-12
- **Status:** Accepted

## Context

DevOps stage 5 runs Terraform from the owner's laptop, and Claude runs it (owner, 2026-11-12). Both the AWS CLI and Terraform need AWS credentials.

- The account uses AWS's new projects-based experience (ADR 0030). People sign in through an identity provider into a project. IAM shows no users and says IAM users are for programmatic access only. IAM Identity Center, which the 2026-10-29 plan assumed (`aws sso login`, interview log entry of that date), isn't part of this experience.
- `docs/devops/secrets.md`: no long-lived secrets on disk if it can be avoided.
- The laptop already has a `~/.aws/credentials` file (created by the AWS Toolkit for VS Code in April 2026). Its `[default]` profile holds **working long-lived access keys for an IAM user of another project**, in another account, with `[default]` set to `us-east-1`. Any AWS tool run without a profile acts on that account.

What we checked on 2026-11-12:

- AWS CLI v2.40.0, installed with `winget`. The old broken v1 launchers in `Python311\Scripts` were deleted (owner's OK).
- AWS's page "Connect an AI coding tool" documents `aws login --profile <name>`. It opens the browser; you pick the project and a session. The credentials are valid for **12 hours**, AWS renews them for **90 days**, and then the browser asks again.
- `aws login --profile business-software` worked. `sts get-caller-identity` shows an **assumed role, `AccountFullAccessRole`**, with temporary credentials. The CLI keeps them in its own cache under `~/.aws/login/`; `~/.aws/config` only gets a `login_session` line.
- Terraform reads `login_session` from AWS provider **6.23.0** on (2025-11-26), and the S3 state backend from Terraform **1.15.0** on (2026-04-29). That comes from a Classmethod article, not yet from the official changelogs; stage 5's first `terraform init` with the S3 backend proves it. We have Terraform 1.17.1; the newest AWS provider is 6.73.0.

## Options considered

### Option A — `aws login` with a named profile (chosen)
- Pros: the same sign-in as the console, MFA included (it lives on the identity, ADR 0030). Temporary credentials only, renewed for 90 days. Terraform and its S3 backend read it natively, with no wrapper. No IAM user to create.
- Cons: the role is full access to the project, not least privilege. Credentials sit in a cache file for up to 12 hours (temporary, but usable by anything running as the owner). Needs a new enough CLI, provider and Terraform.

### Option B — an IAM user with access keys
- Pros: works with every tool and every version.
- Cons: long-lived keys on disk, exactly what `secrets.md` avoids; the laptop already shows how such keys linger for months. IAM users here are meant for programs, not people.

### Option C — AWS's "Agent Toolkit for AWS" setup (`aws configure agent-toolkit`, or the console's "Copy agent prompt")
- Pros: AWS's suggested path for coding agents in this experience; uses the same `aws login` underneath.
- Cons: it also installs an MCP server, AWS skills and its own rule file into Claude Code. None is needed for Terraform, and a second rule file would compete with `CLAUDE.md`. Can be added later if a real need appears.

### Option D — IAM Identity Center (`aws sso login`)
- Pros: the classic answer for people's access in an AWS Organization.
- Cons: needs an Organization and, in this experience, advanced features. ADR 0030 forbids both.

## Decision

Option A. The laptop signs in with **`aws login --profile business-software`**. The profile's Region is `ap-southeast-2`. Every AWS CLI call and every Terraform run in this project **names that profile**, never `[default]`:

- Terraform's provider and S3 backend set `profile = "business-software"` and `region = "ap-southeast-2"`.
- The provider sets **`allowed_account_ids`**, read from a git-ignored `terraform.tfvars` (the account ID never goes in the public repo). Terraform then refuses to plan or apply against any other account, whatever credentials it finds.
- Version floors: AWS CLI ≥ 2.32, Terraform ≥ 1.15, AWS provider ≥ 6.23 (pinned in `required_version` and `required_providers`).

## Why

It's the only option with no long-lived secret and no extra moving parts, and both tools support it natively. The account guard matters more than usual here, because a working key for another account is one forgotten `--profile` away.

## Consequences

- When the 12 hours run out mid-session, `terraform plan` fails with an expired-credentials error; run `aws login --profile business-software` again. After 90 days the browser asks again.
- The laptop session is full access. That's acceptable for the single owner's laptop. CI gets its own narrow role through OIDC in stage 6 (ADR 0012), never this profile.
- AWS says the account holder is responsible for what an AI coding tool does with these credentials, so Terraform runs as `plan` first, with the cost stated, and `apply` only after the owner's OK. Destroying anything needs the owner's explicit OK (`CLAUDE.md` rule 7).
- Cleaned up the same day, with the owner's OK: the other project's `[default]` profile was renamed to a named profile, so a command without `--profile` now fails with `NoCredentials` instead of acting on another account. Its key couldn't be deactivated from the laptop (the key may not manage itself, and the second profile's key was already invalid), so **the owner deactivates it in that account's IAM console**, then deletes it.
- The 2026-10-29 plan of `aws sso login` (interview log) is superseded; the idea, temporary credentials and no access keys, is the same.

## Interview note

My AWS account uses the new projects-based sign-in, so I used `aws login`, which turns my console session into 12-hour credentials that renew for up to 90 days; Terraform's AWS provider reads them natively, so there are no access keys anywhere. My laptop also had a live access key for a different project as the default profile, so every command names its profile and the Terraform provider has `allowed_account_ids`: even with the wrong credentials it refuses to touch another account. The trade-off is that the laptop session has full access, so CI gets its own narrow OIDC role instead.
