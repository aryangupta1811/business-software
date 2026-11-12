# 0032 — Stage 5 server shape: Ubuntu 26.04 ARM64, an auto-assigned IP with DuckDNS, a nightly stop; Sydney cost estimate

- **Date:** 2026-11-12
- **Status:** Accepted

## Context

ADR 0011 chose one EC2 server running Docker Compose plus RDS PostgreSQL. ADR 0030 moved it to Sydney `ap-southeast-2` and asked stage 5 to redo the cost estimate with Sydney prices before creating anything. The owner's rule is that the project stays fully free (ADR 0030), and the plan is to run the server and database only for work sessions and demos.

Checked on 2026-11-12 with the CLI (ADR 0031) in this project:

- EC2 offers `t4g.small` and `t4g.micro` in Sydney, and both are on the account's Free plan list (`free-tier-eligible`): `t3.micro`, `t3.small`, `t4g.micro`, `t4g.small`, `t8i.micro`, `t8i.small`, `c7i-flex.large`, `m7i-flex.large`. The `t8i` types are new since ADR 0011's 2026-11-10 note.
- RDS offers PostgreSQL 18.1–18.6 on `db.t4g.micro` with gp3 storage. **18.6** matches the local `postgres:18` image.
- Ubuntu publishes ARM64 images for 24.04 and **26.04 LTS** in Sydney (public SSM parameter `/aws/service/canonical/ubuntu/server/26.04/stable/current/arm64/hvm/ebs-gp3/ami-id`). Docker's apt repository has 26.04 (`resolute`) for `arm64`.
- Latency from the owner's laptop (TCP connect time, DNS excluded, 8 tries): Mumbai ~55–80 ms, **Sydney ~270–300 ms**. So Sydney adds about **0.2 s per round trip**, more than ADR 0030's 0.1–0.15 s estimate.

**Sydney prices** (AWS Pricing API, on-demand, USD, 2026-11-12):

| Item | Price | Running 24/7 (730 h) | While stopped |
| --- | --- | --- | --- |
| EC2 `t4g.small` (Linux) | $0.0212/h | $15.48 | $0 |
| Public IPv4 address, in use | $0.005/h | $3.65 | $0 if auto-assigned; $3.65 if an Elastic IP |
| RDS `db.t4g.micro` PostgreSQL, Single-AZ | $0.025/h | $18.25 | $0 |
| EBS gp3, 20 GB (server disk) | $0.096/GB-month | $1.92 | $1.92 |
| RDS gp3, 20 GB | $0.138/GB-month | $2.76 | $2.76 |
| RDS backups | free up to the database's size, then $0.095/GB-month | $0 | $0 |
| S3 Standard (state, later dumps) | $0.025/GB-month | < $0.05 | < $0.05 |
| **Total** | **$0.0512 per running hour + $4.73 a month** | **≈ $42 a month** | **$4.73 a month** |

(`t4g.micro` would be $0.0106/h, saving $7.74 a month at 24/7.)

## Options considered

### Public address: auto-assigned public IPv4 (chosen) or an Elastic IP
- Auto-assigned: billed only while the server runs; released on stop, so the address changes at every start. Needs a DNS name that follows it.
- Elastic IP: a fixed address, but billed every hour, running or stopped ($3.65 a month), which is half the running budget for a session-only server.

### Domain: a DuckDNS subdomain (chosen) or a GitHub Student Pack domain
- DuckDNS: free, ready today, and its update URL fits a changing IP. A subdomain can't hold the DNS records Amazon SES needs (P1.4's note h).
- Student Pack domain: a real domain for SES later, but the Pack's approval was still pending, and a changing IP then needs Route 53 ($0.50 a month per hosted zone) or the registrar's API. P1.4's email ADR can bring it in.

### Operating system: Ubuntu 26.04 LTS ARM64 (chosen) or Amazon Linux 2023 ARM64
- Ubuntu: automatic security updates are on by default (ADR 0011 wants them), Docker's official repository includes the Compose plugin, the SSM agent comes preinstalled on AWS's Ubuntu images, and it's what most jobs use. 26.04 is supported until 2031; 24.04 is the fallback if something in 26.04 fails.
- Amazon Linux 2023: AWS's own OS with SSM built in, but updates aren't applied automatically and Docker Compose must be installed by hand.

### Automatic stopping: a nightly schedule (chosen), a budget action, or both
- Nightly schedule (EventBridge Scheduler): stops EC2 and RDS every night, catching a forgotten session within hours. About 60 invocations a month, effectively free.
- Budget action: AWS Budgets stops the instances when the $15 budget is reached. The first two action budgets are free, but it needs another IAM role, and by then $15 is already spent. The owner left it out.

## Decision

- **Server:** EC2 `t4g.small` (ADR 0011), **Ubuntu 26.04 LTS ARM64**, the image ID read from Canonical's public SSM parameter. Terraform ignores later image changes, so a new Ubuntu build doesn't replace the server.
- **Address:** an **auto-assigned public IPv4**, no Elastic IP. At every boot the server updates a **DuckDNS** subdomain before Caddy starts. The DuckDNS token is a secret: an SSM `SecureString`, read by the server through its instance role.
- **Nightly stop:** an **EventBridge Scheduler** schedule stops the EC2 instance and the RDS instance every night at **23:30 IST** (`Asia/Kolkata`), with a role that may only stop those two. Stopping by hand after each session stays the rule; stage 7 builds on this schedule.
- **Database:** RDS `db.t4g.micro`, **PostgreSQL 18.6**, gp3 20 GB (gp3's minimum), Single-AZ, not publicly reachable.
- **Region:** `ap-southeast-2` for everything (ADR 0030).

## Why

At session-only use (about 60 running hours a month) the whole setup costs about **$7.80 a month**, about **$47 until the account closes on 2027-05-12**, leaving room in the $100 credits for a month of 24/7 during placement season (~$42). Every choice above removes a charge that runs while nothing is used: no Elastic IP, a schedule that ends a forgotten session, and an OS that patches itself without a person.

## Consequences

- The server's IP changes at each start, so DuckDNS must be updated before anything depends on the name. DNS takes up to its TTL (60 s on DuckDNS) to follow. Caddy's Let's Encrypt certificate lives on the server's disk, so a restart doesn't request a new one.
- ADR 0011's estimate of $30–35 a month at 24/7 becomes about **$42** in Sydney (dated note added there). 24/7 for more than about two months would need the extra $100 from the credit activities.
- **Measured latency is 0.2 s per round trip.** The billing screen (NFR 5: a scanned item on screen in under 200 ms) can't wait for a round trip per scan from India. P1.13 must look items up from a copy in the browser, which is sensible anyway.
- RDS restarts itself after 7 days stopped; the nightly schedule stops it again the same night.
- The schedule's stop of an already-stopped instance fails harmlessly; check that it doesn't produce alarms or retries that cost money.
- Ubuntu's automatic updates can need a reboot (kernel). Decide in stage 5 whether to allow unattended reboots, given the server is off most of the time anyway.

## Interview note

I priced the setup with the AWS Pricing API in my Region before creating anything: about $42 a month around the clock, but only $0.05 per running hour plus $4.73 a month of storage, so I run it for sessions and demos and stay near $8 a month. I didn't use an Elastic IP, because it bills even while the server is stopped; the server updates a free DuckDNS name at boot instead, and a nightly schedule stops the server and database in case I forget. Measuring latency showed Sydney adds 0.2 s per round trip from India, which told me the billing screen must look items up locally instead of asking the server for each scan.
