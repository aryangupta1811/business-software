# Backups and restores (stage 7)

How the demo database is backed up, how to check a backup works, and how to get data back. Design and reasons: ADR 0037. The zero-data-loss rule: `CLAUDE.md` rule 7, `product-overview.md` NFR 1.

## The two copies

| Copy | Where | How far back | Restores to |
| --- | --- | --- | --- |
| RDS automated backups | Inside RDS | The last **1 day** the database ran (Free plan cap; time stopped doesn't count) | Any moment in that day, to about 5 minutes, as a **new** RDS instance |
| Nightly `pg_dump` | S3 bucket `business-software-demo-backups-<account>` (name in SSM `/business-software/demo/backup/bucket`) | **90 days**, then 30 more as older versions | The moment of that dump, into any PostgreSQL 18 |

Use RDS's own copy for "undo the last few hours"; use the S3 copy for anything older, or if the RDS instance itself is gone.

## How the nightly backup works

1. `business-software-backup.timer` on the server starts `business-software-backup.service`:
   - at **22:45 IST**, if the server is running then;
   - at the **next boot**, if it wasn't (`Persistent=true`). Nothing changes while the server and RDS are stopped, so that copy is the end of the last session.
2. `/opt/business-software/backup.sh` reads the RDS host, the bucket and `app_backup`'s password from SSM, then runs `dump.sh` in the `postgres:18` image over TLS (`verify-full`).
3. `dump.sh`, as the read-only role `app_backup`:
   1. refuses to run if any table under RLS lacks its `backup_read` policy (it would be dumped empty);
   2. opens one snapshot;
   3. runs `pg_dump --enable-row-security --format=custom --compress=zstd` on it;
   4. counts every table's rows in the same snapshot.
4. Both files go to S3 under `postgres/YYYY/MM/DD/business_software-<UTC time>.dump` and `.counts.tsv`, the counts last. A backup with no `.counts.tsv` is incomplete.
5. If it fails (say RDS is still starting after a boot), systemd tries again every minute, up to 20 times in 30 minutes.

**What the server may do with the bucket:** only add files under `postgres/`. It can't read, list or delete backups, so whoever takes over the server can't destroy or read the history.

**No alert on failure yet** (stage 9). Until then, check now and then with `scripts/deploy/backup.sh list`.

## Everyday commands (laptop, Git Bash)

Needs `aws login --profile business-software`; `now` and `drill` need the server and RDS running.

```bash
scripts/deploy/backup.sh now      # a backup right now: before stopping after a session with real changes
scripts/deploy/backup.sh list     # complete backups in S3, newest last
scripts/deploy/backup.sh drill    # restore drill on the newest backup (or pass a key from list)
```

On the server (Session Manager shell): `systemctl list-timers business-software-backup.timer` shows the next run; `journalctl -u business-software-backup` shows past runs.

## The restore drill (monthly, and after any change to backups)

`scripts/deploy/backup.sh drill [key]`:

1. On the laptop, makes two pre-signed links (15 minutes) to the backup's `.dump` and `.counts.tsv`. The server can't read the bucket itself.
2. On the server, `restore-drill.sh`:
   1. downloads both files;
   2. starts a throwaway `postgres:18` container (data in memory, no published port);
   3. creates the app roles with throwaway passwords;
   4. runs `pg_restore --single-transaction --exit-on-error`;
   5. compares every table's row count with the backup's counts.
3. Prints `restore check: OK, N tables, M rows, every count matches`, or the tables whose counts differ, and removes the container either way. RDS is never touched.

Write the date, the key and the result in the log below. The same scripts run in CI on every push (`packages/db/src/backup.test.ts`), so a drill failing here points at the server or the data, not the scripts.

| Date | Backup key | Result |
| --- | --- | --- |
| | | |

## Getting data back

**Ask the owner first, and take a fresh backup of the current state before anything else** (`CLAUDE.md` rule 7). Never restore over the live database: restore next to it, check, then switch.

### A mistake in the last day: RDS point-in-time restore

1. Find the time just before the mistake (the entry log helps).
2. Console or CLI: `aws rds restore-db-instance-to-point-in-time --source-db-instance-identifier business-software-demo --target-db-instance-identifier business-software-demo-restored --restore-time <UTC time> --db-subnet-group-name business-software-demo --vpc-security-group-ids <db security group> --no-publicly-accessible --profile business-software --region ap-south-1`. The new instance is billed while it runs: state the cost first.
3. Check the rows you need on the new instance (from the server, as the master), then either copy them back or, with the owner's OK, point the app at it. Terraform doesn't know the new instance: bring it under Terraform or delete it afterwards, with the owner's OK.

### Anything older, or RDS lost: restore an S3 backup

1. `scripts/deploy/backup.sh list`, and pick the newest backup from before the problem.
2. Prove it first: `scripts/deploy/backup.sh drill <key>`.
3. Into an empty RDS database (a new instance, or a new database on the same instance), from a Session Manager shell, as the master user:
   1. run `create-roles.sql` and `create-backup-role.sql` if the roles don't exist there;
   2. `pg_restore --single-transaction --exit-on-error --dbname=<new database>` with the downloaded `.dump` (download it on the laptop with `aws s3 cp`, then copy it to the server; the server can't read the bucket);
   3. compare the row counts with the `.counts.tsv`, as `restore-check.sh` does.
4. Point the app at it (`db/host` in SSM, or rename databases) with the owner's OK, and redeploy.

The roles themselves aren't in the dump (RDS forbids reading role passwords): `create-roles.sql` and the SSM passwords recreate them.

## Gotchas

- **`--enable-row-security` is required, and dangerous.** Without it, `pg_dump` as `app_backup` fails; with it, a table missing its `backup_read` policy is dumped with no rows. The guard test (CI) and `dump.sh`'s own check stop that, so don't remove either.
- **A new schema breaks the backup on purpose.** `app_backup` can read only what migration 0005 granted (public and drizzle). pgboss (P2.7) must be granted or excluded deliberately.
- **Not before migration 0005 is deployed.** The backup needs `app_backup` and its grants on RDS, which arrive with the first deploy after P1.4 (deploy hold).
- **The drill's pre-signed links stay in Systems Manager's command history** (expired after 15 minutes). They grant read access to those two files only.
