# Terraform runbook: sign in, plan, apply, start and stop

Every AWS resource in this project comes from the Terraform in `infra/terraform/` (ADR 0031). This page covers the commands for day-to-day work. Why it's built this way: `docs/plans/2026-11-12-stage-5-terraform.md` and ADRs 0011, 0031–0033. The account itself, the money rules and laptop tools: `aws-account.md`.

**Who runs what:** Claude runs Terraform and the AWS CLI (owner, 2026-11-12). Every change follows the same steps: `plan`, then the cost stated, then `apply` only after the owner's OK. Deleting anything needs the owner's explicit OK; deleting the database also needs a fresh snapshot (`CLAUDE.md` rule 7).

## The two roots

| Folder | What it holds | State |
| --- | --- | --- |
| `infra/terraform/bootstrap/` | The S3 bucket for Terraform's state, and the `monthly-credit-burn` budget | In the bucket it made (`bootstrap/terraform.tfstate`) |
| `infra/terraform/demo/` | VPC, subnets, security groups, RDS, the EC2 server, its role, the SSM copy of the master password, the two nightly stop schedules | In the same bucket (`demo/terraform.tfstate`) |

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
- If `init` fails with "connection was forcibly closed", this network's IPv6 is the cause. The fix (a local provider mirror) is in `HANDOFF.md`, "Watch out for".

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

- `terraform output` prints `server_instance_id`, `server_public_dns`, `db_address` and the SSM name of the master password. It never prints secrets.
- RDS takes several minutes to start or stop; check with `aws rds describe-db-instances … --query "DBInstances[0].DBInstanceStatus"`.
- **Safety net:** two EventBridge Scheduler schedules stop both every night at 23:30 IST.
- The server gets a new public IP at every start (no Elastic IP: it bills while idle). DuckDNS follows it from stage 5 part 3.
- RDS starts itself again after 7 days stopped; the nightly schedule stops it again the same night.

## Getting onto the server

There's no SSH key and port 22 is closed. Use Systems Manager instead:

- **A shell:** `aws ssm start-session --profile business-software --region ap-south-1 --target <server_instance_id>`. Needs the Session Manager plugin on the laptop (`winget install --id Amazon.SessionManagerPlugin`, installed 2026-11-17).
- **A script without a shell:** Run Command, `aws ssm send-command … --document-name AWS-RunShellScript --parameters file://params.json`. Read the output with `aws ssm get-command-invocation`. Stage 5's checks ran this way.
- **Reading a secret on the server:** the instance role can read `/business-software/demo/*` in SSM. Read the value into a variable inside the script and never print it.

## The database

- PostgreSQL 18.6 on `db.t4g.micro`, in private subnets. Port 5432 is open only to the server's security group; from the laptop the name resolves to a private `10.20.x.x` address and nothing answers.
- **TLS is required.** `rds.force_ssl` is `1` by default from PostgreSQL 15 (checked in the account's `postgres18` defaults). A connection with `sslmode=disable` is refused with `no pg_hba.conf entry … no encryption`.
- **Backups:** automated backups for **1 day**. The Free plan refused 7 days (`FreeTierRestrictionError`). Point-in-time restore covers the last day the database ran; time stopped doesn't count. Stage 7 adds a nightly `pg_dump` to S3 for older history.
- **Master password:** `postgres_admin`'s password is write-only. It went to RDS and to the SSM `SecureString` `/business-software/demo/db/master-password`, and it is never in Terraform state (checked 2026-11-17: 0 matches in `terraform state pull`).
  - **To rotate:** raise `db_password_version` in `demo/variables.tf` by one, then plan and apply. One new password goes to both.
  - **Why SSM waits for RDS:** the SSM copy is written only after RDS accepts the password (`depends_on`). A failed RDS step therefore can't leave SSM holding a password RDS doesn't have, which is what happened once on 2026-11-17.
- Deleting the database needs two deliberate steps, because `deletion_protection` is on. A final snapshot is always taken.

## When an apply fails halfway

Terraform records whatever it did create, so the next `plan` shows only what is missing. Read the whole error first (it names the resource and AWS's reason), fix the code, plan again, and get the owner's OK again if the plan differs from what was approved.

**Check secrets after a partial apply.** An ephemeral value (like the master password) is new on every run, so resources created in different runs may hold different values. That's how the 2026-11-17 mismatch happened.

## Errors seen so far

| Error | Cause | Fix |
| --- | --- | --- |
| `FreeTierRestrictionError: The specified backup retention period exceeds the maximum available to free tier customers` | The Free plan caps RDS backup retention below 7 days (the exact cap isn't documented) | `backup_retention_period = 1`. Never "upgrade your account plan" (ADR 0033) |
| `InvalidParameterValue: Invalid rule description` | An apostrophe in a security group rule description; AWS allows only `a-zA-Z0-9. _-:/()#,@[]+=&;{}!$*` | Reword it ("Lets Encrypt") |
| `password authentication failed for user "postgres_admin"` with the password from SSM | A partial apply left RDS and SSM with different random passwords | Raise `db_password_version`; `depends_on` now prevents it |
