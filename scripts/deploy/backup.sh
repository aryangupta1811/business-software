#!/usr/bin/env bash
# The demo database's backups, from the laptop (Git Bash). Stage 7, ADR 0037; runbook:
# docs/devops/backup-restore.md.
#   scripts/deploy/backup.sh now           take a backup now (before stopping, after a big change)
#   scripts/deploy/backup.sh list          the backups in S3, newest last
#   scripts/deploy/backup.sh drill [key]   restore one (default: the newest) into a throwaway
#                                          PostgreSQL on the server and check every row count
#   scripts/deploy/backup.sh before-deploy [--first-backup-release]
#                                          as now, for the deploy workflow (stage 6); fails
#                                          if the server has no backup service, unless the
#                                          option says this deploy is the one installing it
# Needs `aws login --profile business-software`; now and drill need the server and RDS
# running. Prints backup keys, never the bucket name (it holds the account ID).
set -euo pipefail
# shellcheck source=scripts/deploy/lib.sh
source "$(dirname "$0")/lib.sh"

readonly service=business-software-backup.service

# MSYS_NO_PATHCONV: Git Bash would turn the /business-software/… name into a Windows path
# (C:/Program Files/Git/business-software/…) and SSM would answer ParameterNotFound.
bucket() {
  MSYS_NO_PATHCONV=1 aws_cli ssm get-parameter \
    --name /business-software/demo/backup/bucket --query Parameter.Value --output text
}

# Complete backups only (a .dump whose .counts.tsv also arrived), oldest first.
list_backups() {
  aws_cli s3api list-objects-v2 --bucket "$(bucket)" \
    --prefix postgres/ --query 'Contents[].[Key, Size]' --output text |
    awk -F '\t' '
      $1 ~ /\.dump$/ { size[substr($1, 1, length($1) - 5)] = $2 }
      $1 ~ /\.counts\.tsv$/ { done[substr($1, 1, length($1) - 11)] = 1 }
      END { for (k in size) if (k in done) printf "%s.dump\t%d bytes\n", k, size[k] }' |
    sort
}

# reset-failed first: after 20 failed tries at boot (RDS still starting) systemd refuses to
# start the unit again for 30 minutes, even by hand.
readonly backup_lines=(
  "systemctl reset-failed $service"
  "systemctl start $service || { journalctl -u $service -n 30 --no-pager -o cat; exit 1; }"
  "journalctl -u $service -n 2 --no-pager -o cat"
)

case ${1:-} in
  now)
    run_on_server "backup now" 900 'set -eu' "${backup_lines[@]}"
    ;;
  before-deploy)
    # No deploy without a fresh backup (CLAUDE.md rule 7). The one exception is chosen by a
    # person: the first deploy of a release with stage 7, on a server that has never had the
    # backup service (that deploy installs it). Then a missing service skips the backup;
    # without the option it stops the deploy, whatever removed the service.
    case ${2:-} in
      --first-backup-release)
        missing="echo 'backup: skipped, no backup service on the server yet (this deploy installs it)'; exit 0"
        ;;
      '')
        missing="echo 'backup: no backup service on the server, so no fresh backup: not deploying. For the first deploy with backups, run the deploy by hand with first_backup_release ticked' >&2; exit 1"
        ;;
      *)
        echo "usage: backup.sh before-deploy [--first-backup-release]" >&2
        exit 2
        ;;
    esac
    run_on_server "backup before deploy" 900 'set -eu' \
      "if ! systemctl cat $service >/dev/null 2>&1; then $missing; fi" \
      "${backup_lines[@]}"
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
    dump_url=$(aws_cli s3 presign "s3://$b/$key" --expires-in 900)
    counts_url=$(aws_cli s3 presign "s3://$b/${key%.dump}.counts.tsv" --expires-in 900)
    echo "drill: $key"
    run_on_server "restore drill" 900 \
      "bash /opt/business-software/restore-drill.sh '$dump_url' '$counts_url'"
    ;;
  *)
    sed -n '2,13p' "$0" >&2
    exit 2
    ;;
esac
