# 0011 — Hosting: AWS Free plan, one EC2 server + RDS, built with Terraform, ₹0 budget

- **Date:** 2026-10-29
- **Status:** Accepted

## Context

Open question 4 in `product-overview.md` (hosting budget). The owner has **no monthly budget** and will use an AWS Free plan account (owner, 2026-10-29). `docs/devops/DEVOPS_PLAN.md` stages 4–7 (cloud basics, infrastructure as code, deployment, data safety) and its cost rules apply. NFR 1 needs automated backups with point-in-time restore.

AWS Free plan rules for new accounts (official page aws.amazon.com/free, read 2026-10-29):

- "$100 in credits immediately … you can earn up to $100 more. That's up to $200 over 6 months."
- "You won't be charged unless you convert to a Paid plan." There's no surprise bill.
- "The account closes on its own 6 months after you open it or when your credits run out, whichever comes first."
- The Free plan is limited to selected services. EC2 and RDS are available on it.

So the design must average about **$33/month or less**, and the 6-month clock should start only when we really need the cloud.

## Options considered

### Option A — ECS Fargate + load balancer + RDS + S3/CloudFront (the first plan)
- Pros: managed containers; the standard production shape.
- Cons: roughly $45–55/month running 24/7, so the credits would last about 4 months and the account would close early.

### Option B — One EC2 server running the Docker Compose stack, plus RDS PostgreSQL
- Pros: the same containers as on the laptop; roughly $25–35/month, which fits the credits; RDS keeps managed automated backups and point-in-time restore; still teaches EC2, VPC, security groups, IAM, RDS, S3, Systems Manager and Terraform.
- Cons: one server, so no automatic failover; we keep the operating system patched (automated).

### Option C — One EC2 server with PostgreSQL in Docker, archiving to S3
- Pros: cheapest (about $18/month).
- Cons: we'd own backups and point-in-time restore ourselves, which is the riskiest place to cut corners for the top requirement.

### Option D — A free platform outside AWS (Render, Neon, …)
- Pros: no 6-month limit.
- Cons: free tiers sleep or cap the database; teaches little DevOps.

## Decision

Option B, in region **ap-south-1 (Mumbai)**:

- **One EC2 Graviton server** (`t4g.small`, 2 GB, to fit api + worker + Chromium; `t4g.micro` if measurements show it's enough). It runs the same Docker Compose stack as local: **Caddy** (HTTPS with a free Let's Encrypt certificate), `api` and `worker`.
- **One domain for app and API:** Caddy serves the web app's files and forwards `/api` to the `api` container. Same origin means session cookies work (ADR 0009) and there's no CORS. Locally, the Vite dev server proxies `/api` the same way.
- **RDS PostgreSQL** `db.t4g.micro`, single-AZ, with automated backups, point-in-time restore and deletion protection. On top of that, a nightly `pg_dump` to S3 as an independent second copy. Monthly restore drill + written runbook (DevOps stage 7).
- **S3** for backup copies, PDFs, exports and Terraform state.
- **SSM Parameter Store** (standard parameters are free) for secrets, instead of Secrets Manager, which charges per secret per month.
- **Deploys through AWS Systems Manager** (ADR 0012), so no SSH port is open.
- **Container images:** GitHub Container Registry or ECR, whichever is free at our size; decided in stage 6.
- **Not used:** load balancer, NAT gateway, ECS, EKS. Kubernetes stays local (stage 11).
- **Terraform** creates everything. One always-on environment (**demo**, our production). A **staging** copy is created from the same Terraform code only to rehearse a risky change, and destroyed the same day.
- **Domain for HTTPS:** a free domain from the GitHub Student Developer Pack, or a free subdomain (e.g. DuckDNS).
- **Guardrails:** a budget alert on credit usage is set up first (good practice, and one of the credit-earning activities). Before creating anything, Claude states the expected cost against the remaining credits.
- **Timing:** everything in Phase 0 runs locally, so the AWS account is opened only at DevOps stage 4. Ask the owner when placement season is first; if it's later, the cloud stages move later so the 6 months cover it.

## Why

It fits inside the free credits while keeping the one thing that matters most: managed backups with point-in-time restore. The containers are identical on the laptop, in CI and in AWS, so moving to ECS behind a load balancer later is an infrastructure change, not an app change.

## Consequences

- **Estimated cost** (confirm with the AWS Pricing Calculator at stage 4): EC2 `t4g.small` ~$12, 20 GB disk ~$2, public IPv4 address ~$4, RDS `db.t4g.micro` + 20 GB ~$15, S3 and data transfer under $1. That's about $30–35/month, or about $25 with `t4g.micro`. With only the first $100 of credits, that's roughly 3 months, so earn the extra $100 and **stop EC2 and RDS when idle** until placement season. RDS restarts itself after 7 days stopped, so a scheduled stop job is needed.
- **The account closes after 6 months.** Infrastructure is Terraform (rebuildable) and the demo data is a deterministic seed (ADR 0016), so nothing important is lost. Before it closes: export the database, and record a demo video and screenshots for the portfolio.
- **After closing,** the live demo needs a new home (a Paid plan, or a free host). Decide then.
- **One server:** a crash means downtime until it restarts (Compose restart policies + an EC2 auto-recovery alarm). That's fine for a portfolio, and "how I'd scale it" is a good interview answer.
- The OS gets automatic security updates, and the server's security group allows only HTTPS (80/443).

## Interview note

I had a zero-rupee budget and an AWS Free plan with up to $200 of credits over six months, so I designed to the budget: one EC2 server running the same Docker Compose stack as my laptop, Caddy for free HTTPS, and RDS for managed backups and point-in-time restore. I left out the load balancer, NAT gateway and ECS because they'd have used the credits in about four months; since everything is containers and Terraform, moving to ECS behind a load balancer later is an infrastructure change, not an app change. The demo data is a deterministic seed and the infrastructure is code, so even the account closing after six months loses nothing.
