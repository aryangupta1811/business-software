#!/usr/bin/env bash
# The demo database's backups, from the laptop (Git Bash). Stage 7, ADR 0037; runbook:
# docs/devops/backup-restore.md.
#   scripts/deploy/backup.sh now           take a backup now (before stopping, after a big change)
#   scripts/deploy/backup.sh list          the backups in S3, newest last
#   scripts/deploy/backup.sh drill [key]   restore one (default: the newest) into a throwaway
#                                          PostgreSQL on the server and check every row count
# Needs `aws login --profile business-software`; now and drill need the server and RDS
# running. Prints backup keys, never the bucket name (it holds the account ID).
set -euo pipefail
# shellcheck source=scripts/deploy/lib.sh
source "$(dirname "$0")/lib.sh"

readonly service=business-software-backup.service

bucket() {
  aws ssm get-parameter --profile "$profile" --region "$region" \
    --name /business-software/demo/backup/bucket --query Parameter.Value --output text
}

# Complete backups only (a .dump whose .counts.tsv also arrived), oldest first.
list_backups() {
  aws s3api list-objects-v2 --profile "$profile" --region "$region" --bucket "$(bucket)" \
    --prefix postgres/ --query 'Contents[].[Key, Size]' --output text |
    awk -F '\t' '
      $1 ~ /\.dump$/ { size[substr($1, 1, length($1) - 5)] = $2 }
      $1 ~ /\.counts\.tsv$/ { done[substr($1, 1, length($1) - 11)] = 1 }
      END { for (k in size) if (k in done) printf "%s.dump\t%d bytes\n", k, size[k] }' |
    sort
}

case ${1:-} in
  now)
    run_on_server "backup now" 900 \
      'set -eu' \
      "systemctl start $service || { journalctl -u $service -n 30 --no-pager -o cat; exit 1; }" \
      "journalctl -u $service -n 2 --no-pager -o cat"
    ;;
  list)
    list_backups
    ;;
  drill)
    key=${2:-$(list_backups | tail -n 1 | cut -f 1)}
    [[ $key == postgres/*.dump ]] || { echo "no backup to drill (key: '$key')" >&2; exit 1; }
    # The server may not read backups: it gets two links that work for 15 minutes, for these
    # two files only. They stay in Systems Manager's command history, expired.
    b=$(bucket)
    dump_url=$(aws s3 presign --profile "$profile" --region "$region" "s3://$b/$key" \
      --expires-in 900)
    counts_url=$(aws s3 presign --profile "$profile" --region "$region" \
      "s3://$b/${key%.dump}.counts.tsv" --expires-in 900)
    echo "drill: $key"
    run_on_server "restore drill" 900 \
      "bash /opt/business-software/restore-drill.sh '$dump_url' '$counts_url'"
    ;;
  *)
    sed -n '2,9p' "$0" >&2
    exit 2
    ;;
esac
