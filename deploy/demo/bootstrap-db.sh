#!/usr/bin/env bash
# Creates the app roles and database on RDS (ADR 0019), the backup role (ADR 0037) and the
# queue role (ADR 0022). Run as
# root by install.sh on every deploy, before the migrations:
# - create-roles.sql once: skipped when the business_software database already exists;
# - create-backup-role.sql every time: it does nothing once app_backup exists, and gives a
#   database made before it existed the role that migration 0007 needs;
# - create-queue-role.sql every time, the same way: it makes app_queue and its pgboss schema
#   once, and sets the password from SSM on every run.
# Uses the same packages/db/bootstrap files as local Docker and the tests, run by psql from
# the postgres:18 image as RDS's master user, over TLS that checks RDS's certificate.
set -euo pipefail

readonly region=ap-south-1
readonly prefix=/business-software/demo
readonly dir=/opt/business-software
readonly aws=/snap/bin/aws

param() {
  "$aws" ssm get-parameter --region "$region" --name "$prefix/$1" --with-decryption \
    --query Parameter.Value --output text
}

host=$(param db/host)
# Exported, and passed to docker as bare `-e NAME`: docker copies the value from its own
# environment, so it never appears on a command line.
PGPASSWORD=$(param db/master-password)
export PGPASSWORD

psql() {
  docker run --rm -i -e PGPASSWORD -e APP_OWNER_PASSWORD -e APP_RUNTIME_PASSWORD \
    -e APP_BACKUP_PASSWORD -e APP_QUEUE_PASSWORD \
    -v "$dir/certs/rds-ca.pem:/certs/rds-ca.pem:ro" \
    -v "$dir/create-roles.sql:/sql/create-roles.sql:ro" \
    -v "$dir/create-backup-role.sql:/sql/create-backup-role.sql:ro"     -v "$dir/create-queue-role.sql:/sql/create-queue-role.sql:ro" \
    postgres:18 psql \
    "host=$host port=5432 dbname=postgres user=postgres_admin sslmode=verify-full sslrootcert=/certs/rds-ca.pem" \
    -v ON_ERROR_STOP=1 -X -q "$@"
}

exists=$(psql -At -c "select count(*) from pg_database where datname = 'business_software'")
if [[ $exists == 1 ]]; then
  echo "database: business_software already exists"
else
  # If an earlier run stopped halfway (roles made, database not), this fails at CREATE ROLE:
  # finish by hand through Session Manager (docs/devops/terraform.md).
  APP_OWNER_PASSWORD=$(param db/app-owner-password)
  APP_RUNTIME_PASSWORD=$(param db/app-runtime-password)
  export APP_OWNER_PASSWORD APP_RUNTIME_PASSWORD
  psql -f /sql/create-roles.sql
  echo "database: app roles and business_software created"
fi

APP_BACKUP_PASSWORD=$(param db/app-backup-password)
export APP_BACKUP_PASSWORD
psql -f /sql/create-backup-role.sql
echo "database: backup role app_backup in place"

APP_QUEUE_PASSWORD=$(param db/app-queue-password)
export APP_QUEUE_PASSWORD
psql -f /sql/create-queue-role.sql
echo "database: queue role app_queue and schema pgboss in place"
