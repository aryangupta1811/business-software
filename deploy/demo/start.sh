#!/usr/bin/env bash
# Starts the demo stack. Run as root by business-software.service at every boot and after
# every deploy (install.sh restarts the service).
#   1. Points business-software.duckdns.org at this server's new public IP.
#   2. Writes the two connection strings from SSM into memory-only files.
#   3. Starts the containers and waits for them.
# Never prints a secret: values go from `aws ssm` straight into files or curl's stdin.
set -euo pipefail

readonly region=ap-south-1
readonly prefix=/business-software/demo
readonly dir=/opt/business-software
readonly secrets=/run/business-software # /run is in memory: gone at shutdown
readonly subdomain=business-software
readonly aws=/snap/bin/aws # Ubuntu's snap; systemd's PATH doesn't include /snap/bin

param() {
  "$aws" ssm get-parameter --region "$region" --name "$prefix/$1" --with-decryption \
    --query Parameter.Value --output text
}

# 1. DuckDNS. An empty ip= makes DuckDNS use the address the request comes from, which is
# this server's public IP. The token goes to curl on stdin (-K -), never on its command
# line, where any user could read it in the process list. Not fatal: the app still starts,
# and the name keeps its old IP until a later start succeeds.
token=$(param duckdns/token)
answer=KO
for attempt in 1 2 3 4 5; do
  answer=$(printf 'url = "https://www.duckdns.org/update?domains=%s&token=%s&ip="\n' \
    "$subdomain" "$token" | curl -sS --max-time 15 -K - || true)
  [[ $answer == OK ]] && break
  sleep $((attempt * 3))
done
unset token
if [[ $answer == OK ]]; then
  echo "duckdns: $subdomain.duckdns.org updated"
else
  echo "duckdns: update failed (answer '$answer'): is the token in SSM?" >&2
fi

# 2. Connection strings (ADR 0021): migrate gets only app_owner's, api and worker only
# app_runtime's. verify-full: TLS, and the server's certificate must be RDS's own for this
# host name, checked against Amazon's certificate authority (sslrootcert).
# Each value is read into a variable first: a failed read then stops the script (set -e),
# where a $(…) inside printf's arguments would quietly write an empty password.
host=$(param db/host)
owner_password=$(param db/app-owner-password)
runtime_password=$(param db/app-runtime-password)
install -d -m 700 "$secrets"
umask 077
readonly tls='sslmode=verify-full&sslrootcert=/certs/rds-ca.pem'
printf 'MIGRATION_DATABASE_URL=postgresql://app_owner:%s@%s:5432/business_software?%s\n' \
  "$owner_password" "$host" "$tls" >"$secrets/migrate.env"
printf 'DATABASE_URL=postgresql://app_runtime:%s@%s:5432/business_software?%s\n' \
  "$runtime_password" "$host" "$tls" >"$secrets/runtime.env"
unset owner_password runtime_password

# 3. Start. Pulls images it doesn't have yet; --wait returns once migrate has finished and
# the api is healthy, and fails (so systemd retries) if RDS isn't up yet.
docker compose -f "$dir/compose.yaml" --env-file "$dir/release.env" \
  up -d --wait --wait-timeout 300 --quiet-pull --remove-orphans
echo "stack: up ($(cat "$dir/release.env"))"
