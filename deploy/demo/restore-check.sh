#!/usr/bin/env bash
# Restores a backup into an empty PostgreSQL and checks every table's row count (ADR 0037).
#   bash restore-check.sh <name.dump> <name.counts.tsv> <folder with the bootstrap .sql files>
# Runs inside a throwaway postgres:18 container as its superuser (restore-drill.sh on the
# server, src/backup.test.ts in the tests). Exit 0 only if the restore succeeded and every
# table has exactly the rows dump.sh counted, with no table missing or extra.
set -euo pipefail

dump=${1:?usage: restore-check.sh <dump> <counts> <bootstrap folder>}
expected=${2:?usage: restore-check.sh <dump> <counts> <bootstrap folder>}
bootstrap=${3:?usage: restore-check.sh <dump> <counts> <bootstrap folder>}

# The roles the dump's owners, grants and policies name, as on a new server. Throwaway
# passwords: nothing ever logs in to this copy.
APP_OWNER_PASSWORD=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
APP_RUNTIME_PASSWORD=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
export APP_OWNER_PASSWORD APP_RUNTIME_PASSWORD
for file in create-roles.sql create-backup-role.sql; do
  psql -X -q -v ON_ERROR_STOP=1 -d postgres -f "$bootstrap/$file"
done

# All or nothing: one error and the copy stays empty, so a half restore can't pass the counts.
pg_restore --exit-on-error --single-transaction --dbname=business_software "$dump"

# The same count query as dump.sh. As the superuser, RLS doesn't hide any row.
restored=$(mktemp)
trap 'rm -f "$restored"' EXIT
psql -X -q -v ON_ERROR_STOP=1 -At -F $'\t' -d business_software -o "$restored" <<'SQL'
SELECT format('SELECT %L, count(*) FROM %s', c.oid::regclass::text, c.oid::regclass)
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname <> 'information_schema' AND n.nspname NOT LIKE 'pg\_%'
   AND c.relkind IN ('r', 'p')
 ORDER BY 1 \gexec
SQL

if ! diff <(sort "$expected") <(sort "$restored") >/dev/null; then
  echo "restore check: FAILED, row counts differ (table, rows counted at backup, rows restored):" >&2
  join -t $'\t' -a 1 -a 2 -e missing -o 0,1.2,2.2 <(sort "$expected") <(sort "$restored") |
    awk -F '\t' '$2 != $3' >&2
  exit 1
fi
echo "restore check: OK, $(wc -l <"$restored") tables, $(awk -F '\t' '{ n += $2 } END { print n }' "$restored") rows, every count matches"
