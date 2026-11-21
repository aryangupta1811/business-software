# SES on the demo server: a mail-only role handed to the api container

- **Date:** 2026-11-20 (fast track Day 4, session 26, lane 1)
- **Task:** the Terraform follow-up ADR 0040 asked for, so the demo server can send email.
- **Owner's choice (2026-11-20):** a mail-only role (option 1 below).

## The problem found before writing it

ADR 0040 says `SesMailer` signs with "credentials from the default chain (the instance role)". The api runs **inside a container**, and the server's metadata service has `http_put_response_hop_limit = 1` (`infra/terraform/demo/server.tf`, stage 5). That limit exists so containers *can't* reach the instance role: Docker's bridge network adds a hop, so the token request from a container never comes back. As written, `MAIL_TRANSPORT=ses` would fail on the server with "Could not load credentials from any providers". Tests didn't catch it because they use `FakeMailer`.

Options put to the owner:

1. **A mail-only role, assumed by the host** (chosen). Containers still can't see the instance role.
2. Raise the hop limit to 2: one line, but every container (Caddy, worker, api) could then read the instance role's credentials, which decrypt every SSM secret including the RDS master password.
3. No email on the demo (`MAIL_TRANSPORT=none`, recovery key only).

## Design

```
EC2 host (instance role: read SSM, put backups, sts:AssumeRole on the mail role only)
  mail-credentials.sh  (at start.sh and every 20 min by a systemd timer)
    aws sts assume-role  → business-software-demo-mail  (1 hour)
    writes /run/business-software-mail/credentials.json   (memory; root:1000, 0640)
           /run/business-software-mail/config             ([default] credential_process = cat /aws/credentials.json)
api container (user node, uid/gid 1000)
  /run/business-software-mail → /aws (read-only)
  AWS_CONFIG_FILE=/aws/config, AWS_EC2_METADATA_DISABLED=true
  SDK default chain → credential_process → runs it again once the held credentials expire
```

**Terraform (`infra/terraform/demo/mail.tf`):**
- `aws_sesv2_email_identity` for the sender (`var.mail_from`, sensitive, in git-ignored `terraform.tfvars`) and one per extra sandbox recipient (`var.mail_recipients`, default empty). Creating one makes AWS email a verification link to that address.
- Role `business-software-demo-mail`: trusted by the server role only; `max_session_duration` 1 hour (role chaining caps it at 1 hour anyway).
- Its policy: `ses:SendEmail` on `identity/*` in this account and Region, with `ses:FromAddress` = the sender. **Why `identity/*` and not the sender only:** the AWS docs and the `amazon-ses` skill scope sends to the identity behind the From address, but say nothing on whether the sandbox also checks the recipient's identity against IAM. `identity/*` covers both; the `ses:FromAddress` condition still pins who the mail comes from. Unverified until the first real send.
- The server role gets `sts:AssumeRole` on that one role.
- SSM `String`s `/business-software/demo/mail/from` and `…/mail/role-arn` (free, standard tier), so nothing personal is in the repo.

**Server files (`deploy/demo/`):**
- `mail-credentials.sh`: reads the role ARN, assumes it, writes the credentials file atomically (temp file + `mv`), never prints a secret. The AWS CLI's `--query` builds the `credential_process` JSON, so no `jq` is needed.
- `business-software-mail-credentials.{service,timer}`: refresh every 20 min, so the file always has 40+ minutes left.
- `start.sh`: writes `/run/business-software/mail.env`. If the mail parameters exist and the first credentials are written: `MAIL_TRANSPORT=ses`, `MAIL_FROM`, `APP_URL`, `EMAIL_LIMITED=true`. Otherwise `MAIL_TRANSPORT=none` and a log line: **mail never stops the app from starting**, and a deploy before the apply still works.
- `compose.yaml`: the api gets `mail.env`, the read-only mount and the two AWS variables. The worker sends no mail and gets nothing.
- `install.sh`: installs the script and units, enables the timer.

**Tests:** `scripts/deploy/test.sh` runs `mail-credentials.sh` against a fake `aws` (the JSON shape, file modes, a failed assume leaves the old file alone and exits non-zero). One local check in Docker: the real app image reads a fake credentials file through `AWS_CONFIG_FILE` and `credential_process`. Then on the server after the apply: one real email to a verified address, and the ADR's DMARC/spam check.

**Cost:** SES $0.10 per 1,000 recipients; IAM, STS and standard SSM parameters are free. Nothing bills while idle. Under $0.01 a month.

**Docs:** ADR 0040 dated note; `docs/devops/terraform.md` (mail section); `docs/devops/secrets.md` if it lists who can read what; interview log.
