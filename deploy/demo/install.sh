#!/usr/bin/env bash
# Deploys one commit to the demo server. Run as root through Systems Manager by
# scripts/deploy/demo.sh, from a copy of this folder taken from GitHub at that same commit:
#   bash install.sh <40-character commit hash>
# Installs the server files, makes sure the database exists, records which images to run,
# and restarts the stack. Running it again with the same commit changes nothing.
set -euo pipefail

sha=${1:-}
[[ $sha =~ ^[0-9a-f]{40}$ ]] || { echo "usage: install.sh <full commit hash>" >&2; exit 2; }

src=$(cd "$(dirname "$0")" && pwd)
readonly src dir=/opt/business-software

install -d -m 755 "$dir" "$dir/certs"
install -m 644 "$src/compose.yaml" "$dir/compose.yaml"
install -m 755 "$src/start.sh" "$src/bootstrap-db.sh" "$dir/"
install -m 644 "$src/../../packages/db/bootstrap/create-roles.sql" "$dir/create-roles.sql"
install -m 644 "$src/business-software.service" /etc/systemd/system/business-software.service

# Amazon's certificate authorities for RDS in Mumbai (public, from AWS's trust store). The
# app and psql check RDS's certificate against these (sslmode=verify-full).
curl -fsS --max-time 30 -o "$dir/certs/rds-ca.pem.new" \
  https://truststore.pki.rds.amazonaws.com/ap-south-1/ap-south-1-bundle.pem
grep -q 'BEGIN CERTIFICATE' "$dir/certs/rds-ca.pem.new"
chmod 644 "$dir/certs/rds-ca.pem.new"
mv "$dir/certs/rds-ca.pem.new" "$dir/certs/rds-ca.pem"

"$dir/bootstrap-db.sh"

printf 'IMAGE_TAG=%s\n' "$sha" >"$dir/release.env"
systemctl daemon-reload
systemctl enable business-software.service
# restart = stop the old containers, then start.sh with the new images. A few seconds of
# downtime; stage 6 can make this smoother.
systemctl restart business-software.service
echo "deployed: $sha"
