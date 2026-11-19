#!/usr/bin/env bash
# The restore drill (stage 7, ADR 0037; monthly, and after any change to backups). Run as
# root through Systems Manager by scripts/deploy/backup.sh drill, which passes two pre-signed
# links (valid 15 minutes) to one backup's files: the server itself may not read backups.
#   bash restore-drill.sh <link to .dump> <link to .counts.tsv>
# Restores into a throwaway PostgreSQL container on this server, never into RDS, and checks
# every table's row count (restore-check.sh). Nothing outside the container changes.
set -euo pipefail

dump_url=${1:?usage: restore-drill.sh <dump link> <counts link>}
counts_url=${2:?usage: restore-drill.sh <dump link> <counts link>}
readonly dir=/opt/business-software container=business-software-restore-drill

work=$(mktemp -d /var/tmp/business-software-drill.XXXXXX)
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

curl -fsS --max-time 300 -o "$work/backup.dump" "$dump_url"
curl -fsS --max-time 60 -o "$work/backup.counts.tsv" "$counts_url"
for file in restore-check.sh create-roles.sql create-backup-role.sql; do
  cp "$dir/$file" "$work/"
done
chmod -R a+rX "$work"

# Data on a tmpfs: in memory, gone with the container. No port is published.
docker run -d --name "$container" --tmpfs /var/lib/postgresql \
  -e POSTGRES_PASSWORD="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')" \
  -v "$work:/drill:ro" postgres:18 >/dev/null
for _ in $(seq 1 30); do
  # The image's first-start setup restarts the server once; wait for the final one.
  docker exec "$container" pg_isready -q -h 127.0.0.1 2>/dev/null && break
  sleep 2
done

docker exec -e PGUSER=postgres "$container" bash /drill/restore-check.sh \
  /drill/backup.dump /drill/backup.counts.tsv /drill
