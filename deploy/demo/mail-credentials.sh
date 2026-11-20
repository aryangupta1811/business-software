#!/usr/bin/env bash
# Hands the api container short-lived credentials for the mail-only role (ADR 0040's
# 2026-11-20 note, infra/terraform/demo/mail.tf). Run as root by start.sh before the stack
# starts, then every 20 minutes by business-software-mail-credentials.timer.
#
# Containers can't reach the server's own role (metadata hop limit 1, server.tf), so the host
# assumes the mail role and writes, into memory (/run), mounted read-only into the api at /aws:
#   credentials.json  the role's 1-hour credentials, in the AWS SDK's credential_process shape
#   config            tells the SDK to read them: credential_process = cat /aws/credentials.json
# The SDK runs that command again once the credentials it holds expire (tested in the app image,
# 2026-11-20; it doesn't refresh early), by which time this script has written newer ones. Never prints a secret: the credentials go from the AWS CLI
# straight into a file.
# Exits non-zero (and leaves any older file in place) if the role can't be assumed.
set -euo pipefail

readonly region=ap-south-1
readonly prefix=/business-software/demo
readonly aws=${MAIL_AWS:-/snap/bin/aws}               # Ubuntu's snap; the tests pass a fake
readonly out=${MAIL_DIR:-/run/business-software-mail} # in memory: gone at shutdown
readonly group=${MAIL_GROUP-1000} # the api image's user, node (uid/gid 1000); "" = leave as is

role=$("$aws" ssm get-parameter --region "$region" --name "$prefix/mail/role-arn" \
  --query Parameter.Value --output text)
[[ $role == arn:aws:iam::*:role/* ]] || { echo "mail: no mail role in SSM ($prefix/mail/role-arn)" >&2; exit 1; }

# root:node 0750 / 0640: the api's user can read, other users on the host can't.
install -d -m 750 ${group:+-g "$group"} "$out"
umask 027

tmp=$(mktemp "$out/.credentials.XXXXXX")
trap 'rm -f "$tmp"' EXIT
# --query builds the credential_process JSON (Version must be the number 1), so no jq.
# shellcheck disable=SC2016 # `1` is JMESPath's number literal, not a shell command
"$aws" sts assume-role --region "$region" --role-arn "$role" \
  --role-session-name demo-api-mail --duration-seconds 3600 \
  --query '{Version: `1`, AccessKeyId: Credentials.AccessKeyId, SecretAccessKey: Credentials.SecretAccessKey, SessionToken: Credentials.SessionToken, Expiration: Credentials.Expiration}' \
  --output json >"$tmp"
grep -q '"AccessKeyId"' "$tmp" || { echo "mail: assume-role gave no credentials" >&2; exit 1; }
[[ -z $group ]] || chgrp "$group" "$tmp"
chmod 640 "$tmp"
# mv within one folder is atomic: the SDK's `cat` reads the old file or the new one, never half.
mv -f "$tmp" "$out/credentials.json"

if [[ ! -f $out/config ]]; then
  printf '[default]\ncredential_process = cat /aws/credentials.json\n' >"$out/config.tmp"
  [[ -z $group ]] || chgrp "$group" "$out/config.tmp"
  chmod 640 "$out/config.tmp"
  mv -f "$out/config.tmp" "$out/config"
fi
echo "mail: credentials refreshed for 1 hour"
