# DevOps stage 5 — Terraform: plan for parts 2 and 3

> **Status:** proposed 2026-11-12, waiting for the owner's OK (`CLAUDE.md` rule 5). Part 1 (prep) is done: tools installed, sign-in decided (ADR 0031), prices and server shape decided (ADR 0032).

**Goal:** every AWS resource for the demo environment comes from Terraform in this repo. At the end of part 3, today's skeleton (web + api + worker, migrations run) is live over HTTPS at a DuckDNS address, with the database on RDS.

**Who runs what:** Claude runs Terraform and the CLI (owner, 2026-11-12), always `terraform plan` first, the cost stated, `apply` only after the owner's OK. `terraform destroy`, or anything that deletes a resource, needs the owner's explicit OK and, for the database, a fresh snapshot (`CLAUDE.md` rule 7).

**Spec:** ADRs 0011, 0021, 0030, 0031, 0032; `docs/PROGRESS.md` stage 5 notes; `docs/devops/secrets.md`.

## Global constraints

- Region `ap-southeast-2` everywhere. Provider: `profile = "business-software"`, `allowed_account_ids` from a git-ignored `terraform.tfvars` (ADR 0031). `required_version = ">= 1.15"`, AWS provider `~> 6.73` (≥ 6.23 needed for `aws login`).
- `default_tags`: `Project = business-software`, `Environment = demo`, `ManagedBy = terraform`.
- **Nothing that bills while idle:** no NAT gateway, no load balancer, no Elastic IP, no interface VPC endpoints ($0.01+/h each), no Secrets Manager (SSM Parameter Store standard tier is free).
- **The public repo never gets:** the account ID, the state bucket's name if it contains the ID, console URLs, the DuckDNS token, any password. `terraform.tfvars` and `backend.hcl` are git-ignored; `.example` files are committed. `.terraform.lock.hcl` is committed.
- **Secrets never land in Terraform state:** passwords use `ephemeral "random_password"` with write-only arguments (`password_wo` on RDS, `value_wo` on SSM parameters, Terraform ≥ 1.11). Verify both exist in provider 6.73 before relying on them; if one doesn't, stop and decide with the owner.
- Branch per part (`feat/stage-5-network-db-server`, `feat/stage-5-https-deploy`), Conventional Commits, the staged-changes scan from `git-workflow.md`, no AI attribution.
- **After every session:** stop EC2 and RDS by hand (`aws ec2 stop-instances`, `aws rds stop-db-instance`), and check both are stopped.

## Layout

```
infra/terraform/
  bootstrap/          state bucket only; its own state migrated into that bucket
  demo/
    versions.tf       Terraform + provider versions, provider, default tags, account guard
    backend.tf        S3 backend (partial config; bucket name from backend.hcl)
    variables.tf      region, environment, CIDRs, sizes, allowed_account_ids
    network.tf        VPC, subnets, internet gateway, routes, security groups
    server.tf         EC2, instance role + profile, user data
    database.tf       RDS subnet group, instance, master password (write-only)
    schedule.tf       EventBridge Scheduler nightly stop + its role
    outputs.tf        instance ID, public DNS, RDS endpoint (no secrets)
    cloud-init.yaml   server setup at first boot
    terraform.tfvars.example, backend.hcl.example
```

One root module for `demo`. A staging copy (ADR 0011: only to rehearse a risky change) uses the same files with another state key and `environment = "staging"`; turn the files into a module only when that first happens.

## Part 2 (next session): state, network, database, server, nightly stop

1. **Bootstrap the state bucket** (`bootstrap/`, local state first): S3 bucket with versioning, SSE-S3 encryption, all public access blocked, a policy denying non-TLS requests, and a lifecycle rule deleting old state versions after 90 days. Then `terraform init -migrate-state` moves bootstrap's own state into the bucket. **Locking:** the S3 backend's own lock file (`use_lockfile = true`), no DynamoDB table. Cost: cents.
2. **Network** (`network.tf`): VPC `10.20.0.0/16`; two public subnets (server) and two private subnets (RDS needs a subnet group in two Availability Zones) in `ap-southeast-2a`/`2b`; an internet gateway and a route only for the public subnets. The private subnets have no route out, and RDS doesn't need one. Take over the VPC's default security group with no rules (`aws_default_security_group`), so nothing can use it by accident. Security groups:
   - `web`: in 80 and 443 from anywhere, **no 22**; out: all (package updates, image pulls, Let's Encrypt, SSM).
   - `db`: in 5432 only from `web`; no other ingress.
3. **Database** (`database.tf`): `db.t4g.micro`, PostgreSQL **18.6**, gp3 20 GB, `storage_encrypted`, `publicly_accessible = false`, private subnet group, `db` security group, `backup_retention_period = 7`, `deletion_protection = true`, `skip_final_snapshot = false` with a named final snapshot, `copy_tags_to_snapshot`, minor version upgrades on. Master user `postgres_admin`, password write-only and also written (write-only) to SSM as a `SecureString` under `/business-software/demo/`. Check whether RDS's PostgreSQL 18 default already sets `rds.force_ssl = 1`; add a parameter group only if it doesn't.
4. **Server** (`server.tf`, `cloud-init.yaml`): `t4g.small`, Ubuntu 26.04 LTS ARM64 from Canonical's public SSM parameter (`lifecycle { ignore_changes = [ami] }`), public subnet with an auto-assigned public IPv4, gp3 20 GB encrypted root disk, **IMDSv2 required** (`http_tokens = "required"`), no key pair. Instance role: `AmazonSSMManagedInstanceCore` (Session Manager, later deploys) plus `ssm:GetParameter(s)` on `/business-software/demo/*` only. Cloud-init: Docker from Docker's official apt repository (with the Compose plugin), a 2 GB swap file, unattended security upgrades on (automatic reboot off: the server restarts at every session start anyway), the AWS CLI for reading SSM at boot.
5. **Nightly stop** (`schedule.tf`): two EventBridge Scheduler schedules, `cron(30 23 * * ? *)` in `Asia/Kolkata`, universal targets `ec2:stopInstances` and `rds:stopDBInstance`, no retries (stopping a stopped instance just fails). One role allowed only `ec2:StopInstances` on this instance and `rds:StopDBInstance` on this database.
6. **Before `apply`:** run `terraform plan`, list what it creates, and state the cost: about **$0.051 per running hour** and **$4.73 a month** for disks (ADR 0032), plus cents for S3 and the schedule.
7. **Check it works:**
   - Install the Session Manager plugin on the laptop (`winget`), open a shell on the server with `aws ssm start-session`. No SSH key and no port 22.
   - From the server: `docker version`, `docker compose version`, `swapon --show`, `uname -m` = `aarch64`; connect to RDS with `psql` from a `postgres:18` container, check `ssl` is on and `select version()` says 18.6.
   - From the laptop: port 22 refused; RDS's endpoint unreachable from outside.
   - Console Home → "Earn AWS credits": the EC2 and RDS activities, and the budget one from stage 4.
   - The next morning: both instances stopped by the schedule.
8. **CI:** add `terraform fmt -check` and `terraform validate` (with `init -backend=false`) to the existing `check` job, using `hashicorp/setup-terraform` pinned to a SHA. Same five required checks, no new names.
9. Stop EC2 and RDS. Update the runbook (`docs/devops/aws-account.md`, plus a new `docs/devops/terraform.md`: how to sign in, plan, apply, stop and start).

## Part 3 (the session after): HTTPS and the skeleton running on AWS

1. **DuckDNS:** the owner signs in at duckdns.org and picks a subdomain. The token goes into SSM as a `SecureString` without passing through the chat or shell history (decide how in the session). A systemd unit updates DuckDNS at every boot, before Docker Compose starts.
2. **Database roles:** run `packages/db/bootstrap/create-roles.sql` on RDS once, by hand, through Session Manager; the master may first need `GRANT app_owner TO postgres_admin` (ADR 0019). Passwords for `app_owner` and `app_runtime` go into SSM. Decide whether to `REVOKE CONNECT, TEMP ON DATABASE postgres FROM PUBLIC` (review minor from P0.3).
3. **Connection strings:** `MIGRATION_DATABASE_URL` only for `migrate`, `DATABASE_URL` only for `api`/`worker` (ADR 0021), with the real RDS host name. Read one refused-connection log line to check the reason shows (2026-11-10 scan).
4. **Images:** decide the registry in an ADR (ADR 0011 left it to stage 6, but part 3 already needs one). Recommendation: GitHub Container Registry, public, since the images hold no secrets (`secrets.md`); built for `linux/arm64` on the laptop this once; stage 6 moves the build to GitHub's ARM64 runner.
5. **Server Compose file:** the same services as `compose.yaml`, Caddy on the real host name with Let's Encrypt, certificate data on a named volume. Add `Strict-Transport-Security` to Caddy's headers once HTTPS works, with a smoke check.
6. **Check it works:** `/api/health/ready` through HTTPS from the laptop; the four Caddy header checks from `scripts/ci/smoke.sh` against the live URL; a stop and start of the server (new IP, DuckDNS follows, certificate reused); a page load timed from India.
7. Stop both. PROGRESS: stage 5 done; live URL in the README.

## Open questions for these sessions

- `password_wo` and `value_wo`: confirm in provider 6.73 (part 2, step 3).
- RDS takes automated backups only while running. A database that runs only during sessions gets fewer backups, but it also changes only then. Stage 7's restore drill confirms point-in-time restore still covers each session.
- `t4g.micro` instead of `t4g.small` (saves $0.0106 per running hour): measure memory in part 3 with api, worker and Caddy running; Chromium comes in P1.15.
