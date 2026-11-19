# Shared by the scripts that run commands on the demo server:
#   source "$(dirname "$0")/lib.sh"
# Two places run them:
#   - the laptop (Git Bash), after `aws login --profile business-software`;
#   - the deploy workflow (Linux), with one-hour credentials from GitHub's OIDC token in the
#     environment (stage 6, infra/terraform/demo/deploy.tf) and DEMO_INSTANCE_ID set.
# Both need the server running.
# shellcheck shell=bash

readonly region=ap-south-1
# The AWS CLI and Python write to the console in Windows' code page (cp1252), which has no
# "→": printing the server's output crashed demo.sh after a successful deploy (seen
# 2026-11-18). UTF-8 mode fixes both: this variable for the CLI, `-X utf8` for our own
# `python -I` below, which ignores PYTHON* variables.
export PYTHONUTF8=1

# Git Bash has cygpath; Windows Python is `python` there (`python3` can be the Store's stub).
if command -v cygpath >/dev/null; then
  readonly on_windows=true python=python
else
  readonly on_windows=false python=python3
fi

# The AWS CLI for this project: always the Mumbai Region; on the laptop always the named
# profile (CLAUDE.md), in GitHub Actions the credentials the workflow put in the environment.
aws_cli() {
  if [[ ${GITHUB_ACTIONS:-} == true ]]; then
    aws --region "$region" "$@"
  else
    aws --profile business-software --region "$region" "$@"
  fi
}

# The server's instance ID: DEMO_INSTANCE_ID when set (the workflow has no Terraform state),
# otherwise Terraform's output.
server_instance() {
  if [[ -n ${DEMO_INSTANCE_ID:-} ]]; then
    echo "$DEMO_INSTANCE_ID"
  else
    terraform -chdir="$(git rev-parse --show-toplevel)/infra/terraform/demo" \
      output -raw server_instance_id
  fi
}

# main_commit <commit>: prints its full hash if it is on main (origin/main), else fails. Only
# merged commits are deployed: they passed review and CI. One check for demo.sh and the
# deploy workflow.
main_commit() {
  local sha
  sha=$(git rev-parse --verify --quiet "$1^{commit}") ||
    { echo "$1: not a commit in this repository" >&2; return 1; }
  git merge-base --is-ancestor "$sha" origin/main ||
    { echo "$sha is not on origin/main: only merged commits are deployed" >&2; return 1; }
  echo "$sha"
}

# not_older_than_running <commit> <running commit, or empty>: fails if the commit is older
# than the one the server runs (an ancestor of it). Images runs can finish out of order, and an
# automatic deploy must never take the server back; going back is a deliberate act, by hand.
# The same commit again is fine (a rerun). A running commit unknown here only warns.
not_older_than_running() {
  local sha=$1 running=$2
  [[ -n $running && $running != "$sha" ]] || return 0
  if ! git cat-file -e "$running^{commit}" 2>/dev/null; then
    echo "warning: the running release ${running:0:12} is not in this repository; deploying anyway"
    return 0
  fi
  if git merge-base --is-ancestor "$sha" "$running"; then
    echo "${sha:0:12} is older than the running release ${running:0:12}: not deploying." \
      "To go back on purpose, run the deploy workflow by hand with that commit." >&2
    return 1
  fi
}

# run_on_server <comment> <timeout in seconds> <shell line>...
# Runs the lines with plain sh on the server through Systems Manager Run Command (no SSH, no
# open port), waits up to the timeout, prints the output and returns 0 only on Success.
run_on_server() {
  local comment=$1 timeout=$2
  shift 2
  local instance params params_uri command_id status=Unknown
  instance=$(server_instance)

  params=$(mktemp)
  # The lines can hold pre-signed links (backup.sh drill): delete them even when send-command
  # fails and set -e stops the script. ${params:-}: it is local, unset by the time a later
  # exit runs this, and set -u would stop on it.
  trap 'rm -f "${params:-}"' EXIT
  # JSON from Python, so quotes and backslashes in the lines can't break it.
  "$python" -X utf8 -I -c 'import json, sys
print(json.dumps({"commands": sys.argv[2:], "executionTimeout": [sys.argv[1]]}))' \
    "$timeout" "$@" >"$params"

  # On Windows the AWS CLI is a Windows program: it needs the file as C:/…, not /tmp/….
  params_uri="file://$params"
  [[ $on_windows == false ]] || params_uri="file://$(cygpath -m "$params")"
  command_id=$(MSYS_NO_PATHCONV=1 aws_cli ssm send-command \
    --instance-ids "$instance" --document-name AWS-RunShellScript \
    --comment "$comment" --parameters "$params_uri" \
    --query Command.CommandId --output text)
  rm -f "$params"
  echo "$comment: command $command_id sent, waiting…"

  # The CLI's waiter gives up after 100 s. Poll up to the command's own limit instead, so
  # expired credentials can't loop for ever.
  for _ in $(seq 1 $((timeout / 10))); do
    sleep 10
    status=$(aws_cli ssm get-command-invocation \
      --command-id "$command_id" --instance-id "$instance" --query Status --output text) ||
      continue
    [[ $status == Pending || $status == InProgress || $status == Delayed ]] || break
  done

  aws_cli ssm get-command-invocation \
    --command-id "$command_id" --instance-id "$instance" --output json |
    "$python" -X utf8 -I -c 'import json, sys
result = json.load(sys.stdin)
print(result["StandardOutputContent"])
if result["StandardErrorContent"]:
    print(result["StandardErrorContent"], file=sys.stderr)'
  echo "status: $status"
  [[ $status == Success ]]
}
