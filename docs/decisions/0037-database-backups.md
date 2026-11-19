# 0037 — Database backups: nightly pg_dump to S3 as a read-only backup role

- **Date:** 2026-11-19
- **Status:** Accepted (owner, 2026-11-19)

## Context

Zero data loss is the top non-functional requirement (`product-overview.md`), and DevOps stage 7 must be done before real data reaches the demo server (fast-track Day 3, deploy hold until P1.4). What exists today:

- RDS automated backups with point-in-time restore, but for **1 day only**: the Free plan refused 7 (ADR 0011's dated note). They also live and die with the RDS instance.
- Nothing older, and no copy outside RDS.

ADR 0011 asks for a nightly `pg_dump` to S3, a monthly restore drill and a runbook. ADR 0027 adds the trap: tenant tables `FORCE` Row-Level Security, so `pg_dump` as the table owner fails, and with `--enable-row-security` it exits 0 and writes **empty tables**. It said backups need "a role with `BYPASSRLS` (or the RDS master user)".

**New finding (2026-11-19):** on RDS, neither exists.

- AWS's role listing for RDS for PostgreSQL shows "Bypass RLS" only on `rdsadmin`, AWS's own superuser. The master user has `rds_superuser`, which doesn't include it ([Viewing roles and their privileges](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Appendix.PostgreSQL.CommonDBATasks.Roles.View.html)).
- Since PostgreSQL 16, only a role that has `BYPASSRLS` may give it to another, so the master can't create one either.
- Not yet checked on our instance. The owner approved a probe on 2026-11-19 (read `rolbypassrls` for `postgres_admin` over Run Command), but the server couldn't start, twice an hour apart: AWS had no spare `t4g.small` capacity in its zone (`docs/devops/terraform.md`, Errors). The owner chose to keep `t4g.small` in `ap-south-1a` and retry (2026-11-19), so it runs at the next start. This design works whichever way it comes out.

The server and database run only during sessions and stop at 23:30 IST at the latest (ADR 0032), so "nightly at a fixed time" alone would miss most days.

## Options considered

### Option A: `pg_dump` as the RDS master user (the approved plan's wording)
- Pros: no new role; the bootstrap already reads the master password.
- Cons: the master has no `BYPASSRLS` (above), so `pg_dump` fails on every tenant table. Even if it worked, the nightly job would hold the most powerful credential there is.

### Option B: a backup role with `BYPASSRLS`
- Pros: the textbook answer; works locally.
- Cons: RDS won't let us create it (above).

### Option C: a read-only role `app_backup` plus a `backup_read` policy on every tenant table (chosen)
- `backup_read`: `FOR SELECT TO app_backup USING (true)`. `pg_dump --enable-row-security` as `app_backup` then sees every row.
- Pros:
  - Works the same on RDS, locally and in the tests, so the tests prove what production does.
  - Least privilege: `SELECT` only, every transaction `READ ONLY`, no `BYPASSRLS`, no master password in the nightly job.
- Cons:
  - Every tenant table needs one more policy. A table without it would be dumped empty with no error, the exact trap ADR 0027 warned about. Two locks close it:
    - the tenancy guard test fails CI for such a table;
    - `dump.sh` refuses to run on a live database where one is missing.
  - Adds one more secret (`app-backup-password` in SSM).

### Option D: RDS snapshots only (manual or exported to S3)
- Pros: no code.
- Cons:
  - The automated ones last 1 day on the Free plan.
  - Manual snapshots stay inside RDS and are billed as backup storage.
  - Snapshot export writes Parquet, which can't be restored as a database.
  - None of them is a restore we can drill on our own.

### Where the dump runs, and when
- **A systemd timer on the EC2 server (chosen):**
  - 22:45 IST, plus `Persistent=true`, so a night missed while the server was off runs at the next boot;
  - nothing changes while both are stopped, so that copy holds the end of the last session.
  - Rejected: a dump at shutdown, because the nightly stop stops RDS at the same moment.
  - Rejected: a Lambda or EventBridge job, because RDS sits in private subnets and a Lambda in the VPC would need a NAT gateway or endpoints, which bill while idle.

## Decision

- **Who dumps:** every night, the server runs `pg_dump` as the read-only role `app_backup`, inside the `postgres:18` image, over TLS that checks RDS's certificate.
- **One snapshot:** the dump and a per-table row count come from one snapshot.
- **Where the copies go:**
  - both files go to a versioned, encrypted, TLS-only S3 bucket, kept 90 days plus 30 as older versions;
  - the server may only add files there, never read, list or delete them.
- **The drill:** the restore drill restores into a throwaway container on the server, through pre-signed links from the laptop, and checks every row count.

## Why

- It's the only design that reads every business's rows on RDS without giving anything `BYPASSRLS`.
- The same files run in the tests (`packages/db/src/backup.test.ts`), so the restore is proven on every CI run, not only on drill days.
- **Put-only access:** someone who takes over the server can't destroy or read the backup history.
- **Row counts:** the drill checks what matters, that every table has its rows. "The restore exited 0" isn't enough: an empty table restores fine.

## Consequences

- **Tenant tables:**
  - every tenant table spreads `...tenantPolicies(column)` (it replaces `tenantPolicy`);
  - the guard checks, for every tenant table:
    - the exact `backup_read` policy is there;
    - `app_backup` has no write right;
    - no role inherits `app_backup` or may `SET ROLE` to it.
- **Migration order:** migration 0007 needs the role to exist first. `create-backup-role.sql` runs:
  - after `create-roles.sql` in Docker and the tests;
  - on every deploy (`bootstrap-db.sh`, idempotent).
- **Existing local volumes:** they need it once by hand (`docs/devops/local-database.md`).
- **A new schema** that `app_backup` can't read (`pgboss`, P2.7) makes the backup fail loudly. P2.7 decides: grant it, or exclude it.
- **The deploy hold applies:** the backup can only run on RDS after migration 0007 is deployed, which waits for P1.4. Until then the live server runs the skeleton, which stores no business data.
- **Worst case lost:** what changed since the last backup, if RDS itself is lost. RDS's own 1-day point-in-time restore covers that window while the instance exists, so `scripts/deploy/backup.sh now` before stopping closes most of the gap.
- **Review fixes (2026-11-19, PR #32), same decision, tighter:**
  - restores run as `app_owner` (`pg_restore --role=app_owner`): RDS's master isn't a superuser, so it can't load tables another role owns. The drill restores as an administrator with only the master's rights, so the RDS path is the tested one;
  - `create-backup-role.sql` sets the password, the read-only default and `CONNECT` on every run, not only when it creates the role;
  - the bucket policy refuses any write without `If-None-Match: *`, so a backup can be added but never overwritten (applied 2026-11-19 with the owner's OK, $0);
  - after P1.4 (ADR 0039) `app_backup` also reads schema `auth` (`auth.owner_logins`, no RLS), or a restore would lock every owner out; the backup test checks the owners' logins come back.
- **Not covered here:**
  - no alert on a failed backup yet: that's stage 9 (observability);
  - no copy in a second Region or account.
- **Cost:**
  - S3 Standard in Mumbai: $0.025 per GB-month and $0.005 per 1,000 PUTs (Pricing API, 2026-11-19);
  - at a few MB per dump: well under $0.10 a month;
  - SSM standard parameters and IAM are free.

## Interview note

My tables force row-level security, and on RDS no role I can create may bypass it, so I made a backup role that can only read, plus a read-everything policy for that one role on every table, with a CI test that fails if a table forgets it. The dump and the row counts come from one snapshot, the server can only add backups to S3 (never read or delete them), and the restore drill restores into a throwaway database and compares every table's row count. The same scripts run in CI, so I know the restore works before I ever need it.
