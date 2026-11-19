# Terraform runbook: sign in, plan, apply, start and stop

Every AWS resource in this project comes from the Terraform in `infra/terraform/` (ADR 0031). This page covers the commands for day-to-day work. Why it's built this way: `docs/plans/2026-11-12-stage-5-terraform.md` and ADRs 0011, 0031–0033. The account itself, the money rules and laptop tools: `aws-account.md`.

**Who runs what:** Claude runs Terraform and the AWS CLI (owner, 2026-11-12). Every change follows the same steps: `plan`, then the cost stated, then `apply` only after the owner's OK. Deleting anything needs the owner's explicit OK; deleting the database also needs a fresh snapshot (`CLAUDE.md` rule 7).

## The two roots

| Folder | What it holds | State |
| --- | --- | --- |
| `infra/terraform/bootstrap/` | The S3 bucket for Terraform's state, and the `monthly-credit-burn` budget | In the bucket it made (`bootstrap/terraform.tfstate`) |
| `infra/terraform/demo/` | VPC, subnets, security groups, RDS, the EC2 server, its role, the SSM parameters (master password, app role passwords, database host, DuckDNS token placeholder), the two nightly stop schedules | In the same bucket (`demo/terraform.tfstate`) |

Git-ignored files each root needs:
- `terraform.tfvars`, holding `allowed_account_ids` (and the budget's alert email in `bootstrap/`);
- `../backend.hcl`, holding the state bucket's name, which contains the account ID.

The `.example` files next to them show the shape. Never commit the real ones.

## Before any plan or apply

```bash
aws login --profile business-software          # if the 12-hour credentials expired
aws sts get-caller-identity --profile business-software
```

The ARN must end in `user/…`, the admin IAM user, never `root`. The account must be the one in `terraform.tfvars`; Terraform's `allowed_account_ids` also refuses any other account. Mask the account ID in anything you paste or commit.

## Plan and apply

```bash
cd infra/terraform/demo
terraform init -backend-config=../backend.hcl  # once per laptop, or after a provider change
terraform plan -out=<scratch folder>/demo.tfplan
# read the plan, state the cost, get the owner's OK
terraform apply <scratch folder>/demo.tfplan
```

- Save the plan file outside the repo, and apply that exact file. Then what was approved is what runs.
- `terraform fmt -recursive ..` and `terraform validate` before every commit. CI runs both on every PR, with no AWS access (`.github/workflows/ci.yml`, `check` job).
- If `init` fails with "connection was forcibly closed", this network's IPv6 is the cause: TCP over IPv6 connects, then TLS is reset. Use a local provider mirror instead:
  1. Download each provider's zip for `windows_amd64`, plus HashiCorp's `SHA256SUMS` file, from `releases.hashicorp.com` with `curl -4`, and check the zips against it.
  2. Put them in a folder laid out as `<mirror>/registry.terraform.io/hashicorp/<name>/`.
  3. Write a CLI config file with `provider_installation { filesystem_mirror { path = "<mirror>" } }` and point `TF_CLI_CONFIG_FILE` at it for the `init`.
  4. If the lock file ever needs refreshing, run `terraform providers lock -fs-mirror=<mirror> -platform=windows_amd64 -platform=linux_amd64`. Keep **both** platforms: CI runs on Linux with `-lockfile=readonly` and fails without the Linux hashes.

## Start and stop (every session)

The server and database cost money only while running. Stop both after every session, and check they stopped.

```bash
# start
aws ec2 start-instances --profile business-software --region ap-south-1 --instance-ids <server_instance_id>
aws rds start-db-instance --profile business-software --region ap-south-1 --db-instance-identifier business-software-demo
# stop
aws ec2 stop-instances --profile business-software --region ap-south-1 --instance-ids <server_instance_id>
aws rds stop-db-instance --profile business-software --region ap-south-1 --db-instance-identifier business-software-demo
```

- `terraform output` prints `server_instance_id`, `server_public_dns`, `db_address`, `db_identifier` and the SSM name of the master password. It never prints secrets.
- RDS takes several minutes to start or stop; check with `aws rds describe-db-instances … --query "DBInstances[0].DBInstanceStatus"`.
- **Safety net:** two EventBridge Scheduler schedules stop both every night at 23:30 IST.
- **Start RDS first, then the server.** At boot the server's `business-software` service runs migrations; if RDS isn't `available` yet it fails and retries every 30 s, so the other order also works, just slower.
- The server gets a new public IP at every start (no Elastic IP: it bills while idle). At boot, `start.sh` points `business-software.duckdns.org` at it (DuckDNS answers in about a minute).
- After a start: `scripts/deploy/check-live.sh` checks the site from outside.
- RDS starts itself again after 7 days stopped; the nightly schedule stops it again the same night.

## Getting onto the server

There's no SSH key and port 22 is closed. Use Systems Manager instead:

- **A shell:** `aws ssm start-session --profile business-software --region ap-south-1 --target <server_instance_id>`. Needs the Session Manager plugin on the laptop (`winget install --id Amazon.SessionManagerPlugin`, installed 2026-11-17).
- **A script without a shell:** Run Command, `aws ssm send-command … --document-name AWS-RunShellScript --parameters file://params.json`. Read the output with `aws ssm get-command-invocation`. Stage 5's checks ran this way.
- **Reading a secret on the server:** the instance role can read `/business-software/demo/*` in SSM. Read the value into a variable inside the script and never print it.

## The live site (stage 5 part 3)

**https://business-software.duckdns.org** serves the app: Caddy with a Let's Encrypt certificate, the api, the worker and migrations, with the database on RDS. How it fits together (ADR 0034):

| Piece | Where | What it does |
| --- | --- | --- |
| `images` workflow | GitHub Actions, ARM64 runner | On every push to `main`: builds both images, pushes `ghcr.io/aryangupta1811/business-software-{app,web}:<commit>` |
| `scripts/deploy/demo.sh [commit]` | Laptop (Git Bash) | Refuses a commit not on `main` or without images, then sends a Run Command |
| `deploy/demo/install.sh` | Server, from GitHub at that commit | Installs the files below into `/opt/business-software`, downloads Amazon's RDS certificates, runs `bootstrap-db.sh`, writes `release.env` (the commit), restarts the service |
| `bootstrap-db.sh` | Server | Once: if `business_software` doesn't exist, runs `create-roles.sql` as the master user. Every deploy: `create-backup-role.sql` (does nothing once `app_backup` exists) |
| `business-software-backup.timer` → `backup.sh` | Server, 22:45 IST or the next boot | The nightly backup to S3 (ADR 0037, `docs/devops/backup-restore.md`) |
| `business-software.service` → `start.sh` | Server, every boot and deploy | Updates DuckDNS, writes the connection strings to `/run/business-software` (memory, root only), `docker compose up --wait` |

**Hold deploys from P1.3 until P1.4 is merged.** P1.3 adds `POST /api/signup` with no rate limit yet: each call costs an Argon2 hash (about 19 MiB, ADR 0035), so a burst could fill the 2 GB server, and anyone could create businesses on the public site. P1.4 brings the limiter. Until it's on `main`, deploy only commits from before P1.3 (`git log --oneline origin/main`).

**Deploy** (the server and RDS running, `aws login` fresh):
```bash
git fetch origin
scripts/deploy/demo.sh            # origin/main, or a commit hash on main
scripts/deploy/check-live.sh
```

**Logs on the server** (Session Manager shell): `journalctl -u business-software` for the boot and deploy steps; `docker compose -f /opt/business-software/compose.yaml --env-file /opt/business-software/release.env logs api` for a service.

**The DuckDNS token** lives only in SSM. Terraform made the parameter with a placeholder (`value_wo`, so it never reads the real value back). The owner sets it from their own PowerShell, so it never passes through the chat, a shell history or Terraform state:
```powershell
$s = Read-Host "DuckDNS token" -AsSecureString
$t = [System.Net.NetworkCredential]::new('', $s).Password
aws ssm put-parameter --name /business-software/demo/duckdns/token --type SecureString --value $t --overwrite --profile business-software --region ap-south-1
Remove-Variable s, t
```
A new token (duckdns.org can make one) goes in the same way; the next boot or deploy uses it.

**The connection strings** use `sslmode=verify-full` with `sslrootcert` (Amazon's Mumbai certificate bundle), so the app checks it's talking to RDS and not to an impostor. `migrate` gets only `MIGRATION_DATABASE_URL` (app_owner), `api` and `worker` only `DATABASE_URL` (app_runtime) (ADR 0021). Docker keeps each container's environment in its own config under `/var/lib/docker`, readable by root only.

**App role passwords** (`/business-software/demo/db/app-owner-password`, `…/app-runtime-password`, and since stage 7 `…/app-backup-password`) are write-only like the master's. To rotate one: raise `app_password_version`, plan and apply (new values in SSM only), then in a Session Manager shell run `ALTER ROLE app_runtime PASSWORD …` as the master with the new value read from SSM into a variable, then restart the service. Until the `ALTER ROLE`, the app can't log in.

**If `bootstrap-db.sh` stopped halfway** (roles created, database not): it fails at `CREATE ROLE` on the next deploy. Finish by hand as the master in a Session Manager shell (the rest of `create-roles.sql`), then deploy again.

## The database

- PostgreSQL 18.6 on `db.t4g.micro`, in private subnets. Port 5432 is open only to the server's security group; from the laptop the name resolves to a private `10.20.x.x` address and nothing answers.
- **TLS is required.** `rds.force_ssl` is `1` by default from PostgreSQL 15 (checked in the account's `postgres18` defaults). A connection with `sslmode=disable` is refused with `no pg_hba.conf entry … no encryption`.
- **Backups:** automated backups for **1 day**. The Free plan refused 7 days (`FreeTierRestrictionError`). Point-in-time restore covers the last day the database ran; time stopped doesn't count. Stage 7's nightly `pg_dump` to S3 keeps 90 days (`docs/devops/backup-restore.md`). Its bucket, the server's put-only permission and two SSM parameters were applied on 2026-11-19 (10 added, 0 changed, 0 destroyed; under $0.10 a month). A bucket-policy statement refusing any write without `If-None-Match: *` (no backup can be overwritten; PR #32 review) is planned, not applied: 0 to add, 1 to change (`aws_s3_bucket_policy.backups`, in place), 0 to destroy, $0, waiting for the owner's OK.
  - **Still to check:** the backup window is 22:00–22:30 IST, and a session that stops RDS before then never reaches it. After a few sessions, read `EarliestRestorableTime` and `LatestRestorableTime` (`describe-db-instances`) and `describe-db-snapshots --snapshot-type automated`, and write down here whether point-in-time restore still has a base snapshot.
- **Master password:** `postgres_admin`'s password is write-only. It went to RDS and to the SSM `SecureString` `/business-software/demo/db/master-password`, and it is never in Terraform state (checked 2026-11-17: 0 matches in `terraform state pull`).
  - **To rotate:**
    1. Start RDS and wait for `available`. A stopped database can't be modified, and a failed modify can leave state ahead of RDS.
    2. Raise `db_password_version` in `demo/variables.tf` by one, then plan and apply. One new password goes to both.
    3. Log in with the value from SSM, from the server (Run Command), to prove they match.
  - **What `depends_on` covers, and what it doesn't:** the SSM copy is written only after RDS accepts the password. So a failed RDS step can't leave SSM holding a password RDS doesn't have, which is what happened on 2026-11-17. It does **not** cover these cases:
    - SSM failing after RDS succeeded: the retry sends a new password to SSM only.
    - RDS failing after AWS already took the change, e.g. a timeout.

    That's why any failed apply that touched either resource ends with the recovery rule below.
- Deleting the database needs two deliberate steps, because `deletion_protection` is on. A final snapshot is always taken.

## When an apply fails halfway

Terraform records whatever it did create, so the next `plan` shows only what is missing. Read the whole error first (it names the resource and AWS's reason), fix the code, plan again, and get the owner's OK again if the plan differs from what was approved.

**Check secrets after a partial apply.** An ephemeral value (like the master password) is new on every run, so resources created in different runs may hold different values. That's how the 2026-11-17 mismatch happened.

**Recovery rule:** after any failed apply that touched `aws_db_instance.main` or `aws_ssm_parameter.db_master_password`:
1. Start RDS and wait for `available`.
2. Raise `db_password_version` by one, plan and apply.
3. Log in with the SSM value from the server.

This puts one fresh password in both places, whichever step failed.

## Errors seen so far

| Error | Cause | Fix |
| --- | --- | --- |
| `FreeTierRestrictionError: The specified backup retention period exceeds the maximum available to free tier customers` | The Free plan caps RDS backup retention below 7 days (the exact cap isn't documented) | `backup_retention_period = 1`. Never "upgrade your account plan" (ADR 0033) |
| `aws_instance.server must be replaced`, `associate_public_ip_address = false -> true # forces replacement` (plan made while the server was stopped) | A stopped instance has no public IP, so AWS reports `false` | Don't set `associate_public_ip_address`; the public subnet's `map_public_ip_on_launch` gives the IP (2026-11-18). Always read why a plan replaces something |
| `InvalidParameterValue: Invalid rule description` | An apostrophe in a security group rule description; AWS allows only `a-zA-Z0-9. _-:/()#,@[]+=&;{}!$*` | Reword it ("Lets Encrypt") |
| `password authentication failed for user "postgres_admin"` with the password from SSM | A partial apply left RDS and SSM with different random passwords | The recovery rule above (raise `db_password_version`, verify with a login). `depends_on` now prevents the case where RDS fails first |
| `UnicodeEncodeError: 'charmap' codec can't encode character '\u2192'` at the end of `scripts/deploy/demo.sh` (the deploy itself succeeded) | The AWS CLI prints in Windows' code page, cp1252, which has no `→` | Fixed 2026-11-19: the script sets `PYTHONUTF8=1` and prints the output through Python from JSON |
| `ParameterNotFound` from `aws ssm get-parameter --name /business-software/…` in Git Bash, for a parameter that exists | Git Bash turns an argument starting with `/` into a Windows path (`C:/Program Files/Git/business-software/…`) | Prefix the command with `MSYS_NO_PATHCONV=1` (2026-11-19; `scripts/deploy/backup.sh` does) |
| DuckDNS answers `KO` in the server's journal; the site's name doesn't follow a new IP | The token in SSM isn't the account's token (a wrong value has the right shape, a 36-character UUID) | Copy the token again from duckdns.org and put it in SSM with the command in The live site; the next boot or deploy picks it up |
| `InsufficientInstanceCapacity: Insufficient capacity` on `aws ec2 start-instances` (2026-11-19: 14 tries from 11:14 to 11:28 IST, 5 more at 12:22) | AWS had no spare `t4g.small` in the server's Availability Zone (`ap-south-1a`) at that moment. Not our account or plan: a stopped instance gives up its hardware and must find new capacity in the same zone to start | Wait and try again later. If it persists: with the owner's OK, change `server_instance_type` (a stopped instance can change type in place; `t4g.micro` and `t3.small` are also Free plan types) or move the server to the `b` subnet (that replaces it: the server keeps no data). Start RDS only once EC2 is running, so RDS doesn't bill while the server can't start. **Owner's decision (2026-11-19): option (a), keep `t4g.small` in `ap-south-1a` and retry at the next start**; ADR 0037's master-user check runs then |
