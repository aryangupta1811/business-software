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

# mktemp -d makes it 0700: only root reads the copy of the data. Docker runs `docker exec` as
# root too, so the container needs no wider rights on it.
work=$(mktemp -d /var/tmp/business-software-drill.XXXXXX)
cleanup() {
  # -v: also the container's anonymous data volume, the restored copy.
  docker rm -f -v "$container" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

curl -fsS --max-time 300 -o "$work/backup.dump" "$dump_url"
curl -fsS --max-time 60 -o "$work/backup.counts.tsv" "$counts_url"
for file in restore-check.sh create-roles.sql create-backup-role.sql; do
  cp "$dir/$file" "$work/"
done

# The data goes to the image's anonymous volume on disk, removed with the container. Not a
# tmpfs: that is RAM, and the app shares this server's 2 GB. No port is published.
docker run -d --name "$container" \
  -e POSTGRES_PASSWORD="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')" \
  -v "$work:/drill:ro" postgres:18 >/dev/null
ready=false
for _ in $(seq 1 30); do
  # The image's first-start setup restarts the server once; wait for the final one.
  if docker exec "$container" pg_isready -q -h 127.0.0.1 2>/dev/null; then
    ready=true
    break
  fi
  sleep 2
done
if [[ $ready != true ]]; then
  echo "restore drill: the throwaway PostgreSQL didn't start within 60 s:" >&2
  docker logs --tail 20 "$container" >&2
  exit 1
fi

# Restore as RDS's master user would, not as the container's superuser: an administrator with
# only LOGIN CREATEROLE CREATEDB that owns the postgres database (src/backup.test.ts does the
# same). A restore that needs a superuser would pass here and fail on RDS.
docker exec -e PGUSER=postgres "$container" psql -X -q -v ON_ERROR_STOP=1 -d postgres \
  -c 'CREATE ROLE rds_admin LOGIN CREATEROLE CREATEDB' \
  -c 'ALTER DATABASE postgres OWNER TO rds_admin'
docker exec -e PGUSER=rds_admin "$container" bash /drill/restore-check.sh \
  /drill/backup.dump /drill/backup.counts.tsv /drill
