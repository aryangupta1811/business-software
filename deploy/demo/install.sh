#!/usr/bin/env bash
# Deploys one commit to the demo server. Run as root through Systems Manager by
# scripts/deploy/demo.sh, from a copy of this folder taken from GitHub at that same commit:
#   bash install.sh <40-character commit hash>
# Installs the server files and the nightly backup's timer, makes sure the database and its
# roles exist, records which images to run, and restarts the stack. Running it again with the
# same commit changes nothing.
set -euo pipefail

sha=${1:-}
[[ $sha =~ ^[0-9a-f]{40}$ ]] || { echo "usage: install.sh <full commit hash>" >&2; exit 2; }

src=$(cd "$(dirname "$0")" && pwd)
readonly src dir=/opt/business-software

install -d -m 755 "$dir" "$dir/certs"
install -m 644 "$src/compose.yaml" "$dir/compose.yaml"
install -m 755 "$src/start.sh" "$src/bootstrap-db.sh" "$src/backup.sh" "$src/dump.sh" \
  "$src/restore-drill.sh" "$src/restore-check.sh" "$dir/"
install -m 644 "$src/../../packages/db/bootstrap/create-roles.sql" \
  "$src/../../packages/db/bootstrap/create-backup-role.sql" "$dir/"
install -m 644 "$src/business-software.service" "$src/business-software-backup.service" \
  "$src/business-software-backup.timer" /etc/systemd/system/

# Amazon's certificate authorities for RDS in Mumbai (public, from AWS's trust store). The
# app and psql check RDS's certificate against these (sslmode=verify-full).
curl -fsS --max-time 30 -o "$dir/certs/rds-ca.pem.new" \
  https://truststore.pki.rds.amazonaws.com/ap-south-1/ap-south-1-bundle.pem
grep -q 'BEGIN CERTIFICATE' "$dir/certs/rds-ca.pem.new"
chmod 644 "$dir/certs/rds-ca.pem.new"
mv "$dir/certs/rds-ca.pem.new" "$dir/certs/rds-ca.pem"

"$dir/bootstrap-db.sh"

# The release that runs from now on (start.sh and compose read it). The deploy workflow reads
# the one it replaces first (scripts/deploy/current-release.sh) and rolls back to it if this
# one fails. No "previous release" is kept here: after a rollback it would name the failed
# release. The deploy workflow's green runs, each named after its commit, are the record of
# what went live.
replaced=$(cat "$dir/release.env" 2>/dev/null || true)
[[ -z $replaced ]] || echo "replacing: $replaced"
printf 'IMAGE_TAG=%s\n' "$sha" >"$dir/release.env"
systemctl daemon-reload
systemctl enable business-software.service
# The nightly backup (ADR 0037). Enabling the timer runs nothing now; the first backup comes at
# 22:45 IST or the next boot, or by hand with scripts/deploy/backup.sh now.
systemctl enable --now business-software-backup.timer
systemctl reset-failed business-software.service || true
# restart = stop the old containers, then start.sh with the new images: a few seconds of
# downtime (stage 6 can make this smoother). --no-block, then wait for the outcome: a first
# attempt can fail while RDS is still starting, and systemd tries again every 30 s.
systemctl restart --no-block business-software.service
for _ in $(seq 1 60); do # up to 10 minutes
  sleep 10
  case $(systemctl is-active business-software.service) in
    active)
      echo "deployed: $sha"
      exit 0
      ;;
    failed) break ;;
  esac
done
echo "deploy of $sha did not come up; last log lines:" >&2
journalctl -u business-software.service -n 40 --no-pager >&2
# A release that never came up must not stay in release.env: the next deploy would take it as
# the running release, roll back to it, and order commits against it. With the old one back,
# systemd's next try (or the next boot) also starts the old release again.
if [[ -n $replaced ]]; then
  printf '%s\n' "$replaced" >"$dir/release.env"
  echo "release.env is back to: $replaced" >&2
fi
exit 1
