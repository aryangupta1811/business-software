#!/usr/bin/env bash
# Deploys a commit of main to the demo server, from the laptop (Git Bash):
#   scripts/deploy/demo.sh [commit]        default: origin/main
# Needs `aws login --profile business-software`, the server and RDS running, and the
# images for that commit on GHCR (the images workflow builds them on every push to main).
#
# How: Systems Manager Run Command tells the server to download this repo at exactly that
# commit from GitHub, then run deploy/demo/install.sh from it. No SSH, no open port, and the
# server runs only files that are in the public history.
set -euo pipefail

readonly profile=business-software region=ap-south-1
readonly repo=aryangupta1811/business-software

sha=$(git rev-parse --verify "${1:-origin/main}^{commit}")
git merge-base --is-ancestor "$sha" origin/main ||
  { echo "$sha is not on origin/main: only merged commits are deployed" >&2; exit 1; }

for image in business-software-app business-software-web; do
  docker manifest inspect "ghcr.io/aryangupta1811/$image:$sha" >/dev/null 2>&1 ||
    { echo "ghcr.io/aryangupta1811/$image:$sha not found: has the images workflow run?" >&2; exit 1; }
done

instance=$(terraform -chdir=infra/terraform/demo output -raw server_instance_id)

# Plain sh on the server (Run Command's shell): download, unpack only what's needed, run.
params=$(mktemp)
trap 'rm -f "$params"' EXIT
cat >"$params" <<EOF
{"commands":[
  "set -eu",
  "tmp=\$(mktemp -d)",
  "curl -fsSL --max-time 60 -o \$tmp/src.tar.gz https://codeload.github.com/$repo/tar.gz/$sha",
  "tar -xzf \$tmp/src.tar.gz -C \$tmp --strip-components=1 --wildcards '*/deploy/demo/*' '*/packages/db/bootstrap/create-roles.sql'",
  "bash \$tmp/deploy/demo/install.sh $sha",
  "rm -rf \$tmp"
],"executionTimeout":["900"]}
EOF

command_id=$(MSYS_NO_PATHCONV=1 aws ssm send-command --profile "$profile" --region "$region" \
  --instance-ids "$instance" --document-name AWS-RunShellScript \
  --comment "deploy ${sha:0:12}" --parameters "file://$params" \
  --query Command.CommandId --output text)
echo "deploy ${sha:0:12}: command $command_id sent, waiting…"

# The waiter gives up after 100 s; a first deploy pulls images and can take longer.
until status=$(aws ssm get-command-invocation --profile "$profile" --region "$region" \
  --command-id "$command_id" --instance-id "$instance" --query Status --output text 2>/dev/null) &&
  [[ $status != Pending && $status != InProgress && $status != Delayed ]]; do
  sleep 10
done

aws ssm get-command-invocation --profile "$profile" --region "$region" \
  --command-id "$command_id" --instance-id "$instance" \
  --query '[StandardOutputContent, StandardErrorContent]' --output text
echo "status: $status"
[[ $status == Success ]]
