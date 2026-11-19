#!/usr/bin/env bash
# The nightly database backup (stage 7, ADR 0037). Run as root by
# business-software-backup.service: every night at 22:45 IST, at the next boot when the server
# was off then, and on demand (scripts/deploy/backup.sh now).
#   1. pg_dump as the read-only role app_backup, inside the postgres:18 image, over TLS that
#      checks RDS's certificate (dump.sh: the dump and its row counts from one snapshot).
#   2. Uploads both files to S3 under postgres/YYYY/MM/DD/. The server may only add files
#      there: it can't read, list or delete backups (infra/terraform/demo/backup.tf).
# Never prints a secret, nor the bucket name (it holds the account ID).
set -euo pipefail

readonly region=ap-south-1
readonly prefix=/business-software/demo
readonly dir=/opt/business-software
readonly aws=/snap/bin/aws # systemd's PATH doesn't include /snap/bin

param() {
  "$aws" ssm get-parameter --region "$region" --name "$prefix/$1" --with-decryption \
    --query Parameter.Value --output text
}

host=$(param db/host)
bucket=$(param backup/bucket)
# Exported, and passed to docker as bare `-e PGPASSWORD`: never on a command line.
PGPASSWORD=$(param db/app-backup-password)
export PGPASSWORD

# Each backup's name carries its UTC time, so no upload ever replaces another. One reading of
# the clock for the name and the folder: two could fall either side of midnight.
now=$(date -u +%s)
name="business_software-$(date -u -d "@$now" +%Y%m%dT%H%M%SZ)"
key="postgres/$(date -u -d "@$now" +%Y/%m/%d)/$name"
work=$(mktemp -d /var/tmp/business-software-backup.XXXXXX)
trap 'rm -rf "$work"' EXIT

docker run --rm -e PGPASSWORD \
  -e PGHOST="$host" -e PGPORT=5432 -e PGDATABASE=business_software -e PGUSER=app_backup \
  -e PGSSLMODE=verify-full -e PGSSLROOTCERT=/certs/rds-ca.pem \
  -v "$dir/certs/rds-ca.pem:/certs/rds-ca.pem:ro" \
  -v "$dir/dump.sh:/backup/dump.sh:ro" \
  -v "$work:/out" \
  postgres:18 bash /backup/dump.sh /out "$name"

# One PutObject per file (no multipart), with a SHA-256 checksum S3 verifies on arrival.
# --if-none-match '*': add, never replace. The bucket policy refuses a write without it, and S3
# answers 412 if the key exists. The counts go last: a backup is complete when its
# .counts.tsv exists.
for file in "$name.dump" "$name.counts.tsv"; do
  "$aws" s3api put-object --region "$region" --bucket "$bucket" --key "$key${file#"$name"}" \
    --body "$work/$file" --checksum-algorithm SHA256 --if-none-match '*' \
    --output text --query ETag >/dev/null
done
echo "backup: $key.dump uploaded"
