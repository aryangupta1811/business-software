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
# The AWS CLI and Python write to the console in Windows' code page (cp1252), which has no
# "→": printing the server's output crashed the script after a successful deploy (seen
# 2026-11-18). UTF-8 mode fixes both: this variable for the CLI, `-X utf8` for our own
# `python -I` below, which ignores PYTHON* variables.
export PYTHONUTF8=1

sha=$(git rev-parse --verify "${1:-origin/main}^{commit}")
git merge-base --is-ancestor "$sha" origin/main ||
  { echo "$sha is not on origin/main: only merged commits are deployed" >&2; exit 1; }

# Needs Docker Desktop running; works without a login once the packages are public.
for image in business-software-app business-software-web; do
  docker manifest inspect "ghcr.io/aryangupta1811/$image:$sha" >/dev/null || {
    echo "ghcr.io/aryangupta1811/$image:$sha: not found (images workflow not run yet," \
      "package still private, or Docker not running)" >&2
    exit 1
  }
done

instance=$(terraform -chdir=infra/terraform/demo output -raw server_instance_id)

# Plain sh on the server (Run Command's shell): download, unpack only what's needed, run.
params=$(mktemp)
trap 'rm -f "$params"' EXIT
cat >"$params" <<EOF
{"commands":[
  "set -eu",
  "tmp=\$(mktemp -d)",
  "trap 'rm -rf \$tmp' EXIT",
  "curl -fsSL --max-time 60 -o \$tmp/src.tar.gz https://codeload.github.com/$repo/tar.gz/$sha",
  "tar -xzf \$tmp/src.tar.gz -C \$tmp --strip-components=1 --wildcards '*/deploy/demo/*' '*/packages/db/bootstrap/create-roles.sql'",
  "bash \$tmp/deploy/demo/install.sh $sha"
],"executionTimeout":["900"]}
EOF

# The AWS CLI is a Windows program: it needs the parameters file as C:/…, not /tmp/….
command_id=$(MSYS_NO_PATHCONV=1 aws ssm send-command --profile "$profile" --region "$region" \
  --instance-ids "$instance" --document-name AWS-RunShellScript \
  --comment "deploy ${sha:0:12}" --parameters "file://$(cygpath -m "$params")" \
  --query Command.CommandId --output text)
echo "deploy ${sha:0:12}: command $command_id sent, waiting…"

# The CLI's waiter gives up after 100 s; a first deploy pulls images and can take longer.
# Up to 15 minutes (the command's own limit), so expired credentials can't loop for ever.
status=Unknown
for _ in $(seq 1 90); do
  sleep 10
  status=$(aws ssm get-command-invocation --profile "$profile" --region "$region" \
    --command-id "$command_id" --instance-id "$instance" --query Status --output text) || continue
  [[ $status == Pending || $status == InProgress || $status == Delayed ]] || break
done

aws ssm get-command-invocation --profile "$profile" --region "$region" \
  --command-id "$command_id" --instance-id "$instance" --output json |
  python -X utf8 -I -c 'import json, sys
result = json.load(sys.stdin)
print(result["StandardOutputContent"])
if result["StandardErrorContent"]:
    print(result["StandardErrorContent"], file=sys.stderr)'
echo "status: $status"
[[ $status == Success ]]
