#!/usr/bin/env bash
# Dumps the app database and counts its rows, both from one snapshot (ADR 0037).
#   bash dump.sh <output folder> <name>
# Writes <name>.dump (pg_dump custom format, zstd) and <name>.counts.tsv (table, rows).
# Runs inside the postgres:18 image, so pg_dump matches the server's major version. The
# connection comes from libpq's variables (PGHOST, PGUSER, PGPASSWORD, PGSSLMODE…), as the
# backup role app_backup: backup.sh on the server, src/backup.test.ts in the tests.
#
# Why each step:
# - Tenant tables FORCE Row-Level Security, and app_backup has no BYPASSRLS (RDS can't give
#   it), so pg_dump runs with RLS on and the backup_read policies let it see every row. A
#   table without that policy would be saved EMPTY with no error, so step 1 refuses first.
# - The counts and the dump share one snapshot (REPEATABLE READ + pg_export_snapshot), so the
#   restore drill can expect exactly these numbers even if the shop was billing meanwhile.
set -euo pipefail

out=${1:?usage: dump.sh <output folder> <name>}
name=${2:?usage: dump.sh <output folder> <name>}
# For the \! line below, which can't use psql variables.
export DUMP_FILE="$out/$name.dump"
counts="$out/$name.counts.tsv"
rm -f "$DUMP_FILE" "$counts"

# The whole database: the app's tables, and drizzle's migration history so a restored
# database knows which migrations it has. A schema app_backup can't read (pgboss, P2.7) makes
# pg_dump fail loudly, so a new schema is a choice made on purpose (grant it, or exclude it).
psql -X -q -v ON_ERROR_STOP=1 -At -F $'\t' -v counts="$counts" <<'SQL'
-- 1. Every table under RLS must have exactly the backup_read policy app_backup reads with.
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(c.oid::regclass::text, ', ' ORDER BY c.oid::regclass::text) INTO missing
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname <> 'information_schema' AND n.nspname NOT LIKE 'pg\_%'
     AND c.relkind IN ('r', 'p') AND c.relrowsecurity
     AND NOT EXISTS (
       SELECT 1 FROM pg_policy p
        WHERE p.polrelid = c.oid AND p.polname = 'backup_read' AND p.polcmd = 'r'
          AND p.polpermissive AND p.polroles = array[current_user::regrole::oid]
          AND pg_get_expr(p.polqual, p.polrelid) = 'true');
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'no backup_read policy for % on: % (the dump would save them empty)',
      current_user, missing;
  END IF;
END
$$;

-- 2. One snapshot for the dump and the counts.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT pg_export_snapshot() AS snapshot \gset
\setenv DUMP_SNAPSHOT :snapshot

-- 3. The dump, while this transaction keeps the snapshot alive. A failed pg_dump leaves no
-- file behind, and stops psql (SHELL_ERROR, psql 16+).
\! pg_dump --snapshot="$DUMP_SNAPSHOT" --enable-row-security --format=custom --compress=zstd --file="$DUMP_FILE" || { rm -f "$DUMP_FILE"; exit 1; }
\if :SHELL_ERROR
  DO $$ BEGIN RAISE EXCEPTION 'pg_dump failed'; END $$;
\endif

-- 4. Rows per table, as the dump saw them.
\o :counts
SELECT format('SELECT %L, count(*) FROM %s', c.oid::regclass::text, c.oid::regclass)
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname <> 'information_schema' AND n.nspname NOT LIKE 'pg\_%'
   AND c.relkind IN ('r', 'p')
 ORDER BY 1 \gexec
\o
COMMIT;
SQL

[[ -s $DUMP_FILE && -s $counts ]] || { echo "dump: no dump or no counts written" >&2; exit 1; }
echo "dump: $(wc -l <"$counts") tables, $(awk -F '\t' '{ n += $2 } END { print n }' "$counts") rows, $(stat -c %s "$DUMP_FILE") bytes"
