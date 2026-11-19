# 0040 — Email: one `Mailer` interface, Mailpit on this computer, Amazon SES in its sandbox on the demo server

- **Date:** 2026-11-20
- **Status:** Proposed

## Context

P1.4 is the first task that sends email: the owner's email confirmation (Module 00 #32) and the password-reset link (#30), with links that live 7 days and 30 minutes (#42). The recovery key (#31) is the other way back in and needs no email. Constraints:

- **D1 (owner, 2026-11-17): stay free.** No domain is bought; the site is `business-software.duckdns.org`. A DuckDNS subdomain can't hold the DNS records (DKIM, SPF, MAIL FROM) that verifying a sending domain needs.
- **ADR 0033: AWS Free plan, Mumbai.** Nothing that bills while idle. The server has an instance role, so AWS calls need no keys (`docs/devops/secrets.md`).
- Tests and `pnpm dev` must never send real email, and a developer must still be able to click a real link in a real inbox-like page.
- Email must never block a request: the account change is already committed when the email goes out (until P2.7's outbox exists).
- **Module 00 #45:** in the demo, email reaches only verified addresses; everyone else is told so and uses the recovery key.

## Options considered

### Option A — Amazon SES v2 through the AWS SDK on the server, Mailpit over SMTP locally, a fake in tests, behind one `Mailer` interface (chosen)
- Pros: SES is in the same account and Region, signed by the instance role (no SMTP password to store or rotate); $0.10 per 1,000 emails; Mailpit is one small container with a web inbox at `127.0.0.1:8025`, so local links are real; tests read `FakeMailer.sent` with no network.
- Cons: a new SDK package in the API; SES starts in a **sandbox** (verified recipients only, 200 emails a day, 1 a second) until AWS approves production access, which needs a verified domain in practice; a `gmail.com` sender through SES can fail DMARC alignment and land in spam at some receivers (unverified; a real domain with DKIM is the only full fix).

### Option B — SES through its SMTP interface everywhere (one SMTP code path)
- Pros: one transport in code; local and server differ only by URL.
- Cons: SES SMTP needs IAM SMTP credentials, a long-lived secret derived from an access key, which this project avoids entirely (ADR 0031, secrets rules). The SDK uses the instance role instead.

### Option C — a third-party email API (Resend, SendGrid, Brevo free tiers)
- Pros: easy domain-less sending on some; nicer dashboards.
- Cons: another account, an API key to store in SSM and keep out of logs, another vendor's free tier that can change; the project's learning goal is AWS. Most still want a verified domain for good delivery.

### Option D — Gmail SMTP with an app password
- Pros: free, no sandbox, lands in inboxes.
- Cons: a personal account's app password in the server's secrets, Google's sending limits and terms for automated mail, and the owner's personal address as the sender of every business's emails.

### Option E — no email in v1, recovery key only
- Pros: nothing to run or pay.
- Cons: Module 00 #30 and #32 (DECIDED) ask for email reset and confirmation.

## Decision

Option A. `apps/api/src/mail/mailer.ts` defines `Mailer` with four implementations, chosen by `MAIL_TRANSPORT`:

| `MAIL_TRANSPORT` | Implementation | Where |
| --- | --- | --- |
| `ses` | `SesMailer`: `@aws-sdk/client-sesv2` `SendEmail`, credentials from the default chain (the instance role) | the demo server |
| `smtp` | `SmtpMailer`: nodemailer to `SMTP_URL` | `pnpm dev` and `pnpm app:up`, to Mailpit in `compose.yaml` |
| `none` (default) | `NoMailer`: sends nothing, logs one line with the subject only | anywhere email isn't set up yet |
| — | `FakeMailer` | tests (injected, never chosen by config) |

- Messages are plain text in English and then Hindi, because the API doesn't know the reader's language (`apps/api/src/mail/messages.ts`); links are `APP_URL` + `/reset/<businessId>/<token>` or `/confirm-email/<businessId>/<token>`.
- **Sent after commit, best effort** (`sendAfterCommit`): a failure logs the error's message and never the message body (it holds a one-time link). The request still succeeds; the person can press "Send again".
- **The demo:** SES stays in its sandbox (D1). The sender is a verified address kept in SSM / git-ignored `terraform.tfvars`, never in the repo. `EMAIL_LIMITED=true` makes the web app tell the owner that email reaches verified addresses only and the recovery key is the way back in (#45).
- **Mailpit** `axllent/mailpit:v1.34.0`, pinned by digest, ports on `127.0.0.1` only, started by `pnpm db:up`.
- **Price (AWS Pricing API, `ap-south-1`, 2026-11-20):** `APS3-Recipients` $0.0001 per recipient ($0.10 per 1,000), attachments $0.12 per GB. Nothing bills while idle. At demo volume (well under 100 emails a month) that is under $0.01 a month.

## Why

The instance role means no email secret exists anywhere, the cost is effectively zero, and it's the same AWS account the rest of the project already runs in. The interface keeps every caller ignorant of the transport, so tests are fast and offline, and a developer sees real emails with clickable links in Mailpit. The sandbox limit is acceptable because the recovery key already covers everyone email can't reach, which Module 00 #45 accepted.

## Consequences

- **Terraform follow-up (small separate PR):** an SES email identity for the sender and `ses:SendEmail` on the instance role, limited to that identity; the demo deploy then sets `MAIL_TRANSPORT=ses`, `MAIL_FROM`, `APP_URL=https://business-software.duckdns.org` and `EMAIL_LIMITED=true`. Its `terraform plan` and cost go to the owner first. **Until it merges, the demo server runs with `MAIL_TRANSPORT=none`:** no email leaves, and only the recovery key resets a password.
- The owner must click the verification link AWS sends to the sender address, and verify each address that should receive demo emails.
- P2.7's outbox replaces "send after commit" with a queued job; the `Mailer` interface stays.
- Getting out of the sandbox (production access) needs a real domain with DKIM and an AWS request; it's a later decision, not a code change.
- A gmail.com sender may land in spam (DMARC); check one real delivery after the Terraform PR.

## Interview note

Email goes through one small interface with four implementations: SES on the server, Mailpit locally, a no-op, and a fake for tests, so the business code never knows how mail leaves. SES signs with the server's IAM role, so there's no SMTP password or API key to leak, and it costs ten cents per thousand emails. The trade-off is SES's sandbox without a domain: only verified addresses receive mail, so the recovery key is the guaranteed way back in, and the UI says so.
