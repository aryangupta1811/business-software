# Shared by the laptop scripts that run commands on the demo server (Git Bash):
#   source "$(dirname "$0")/lib.sh"
# Needs `aws login --profile business-software` and the server running.
# shellcheck shell=bash

readonly profile=business-software region=ap-south-1
# The AWS CLI and Python write to the console in Windows' code page (cp1252), which has no
# "→": printing the server's output crashed demo.sh after a successful deploy (seen
# 2026-11-18). UTF-8 mode fixes both: this variable for the CLI, `-X utf8` for our own
# `python -I` below, which ignores PYTHON* variables.
export PYTHONUTF8=1

server_instance() {
  terraform -chdir="$(git rev-parse --show-toplevel)/infra/terraform/demo" \
    output -raw server_instance_id
}

# run_on_server <comment> <timeout in seconds> <shell line>...
# Runs the lines with plain sh on the server through Systems Manager Run Command (no SSH, no
# open port), waits up to the timeout, prints the output and returns 0 only on Success.
run_on_server() {
  local comment=$1 timeout=$2
  shift 2
  local instance params command_id status=Unknown
  instance=$(server_instance)

  params=$(mktemp)
  # JSON from Python, so quotes and backslashes in the lines can't break it.
  python -X utf8 -I -c 'import json, sys
print(json.dumps({"commands": sys.argv[2:], "executionTimeout": [sys.argv[1]]}))' \
    "$timeout" "$@" >"$params"

  # The AWS CLI is a Windows program: it needs the parameters file as C:/…, not /tmp/….
  command_id=$(MSYS_NO_PATHCONV=1 aws ssm send-command --profile "$profile" --region "$region" \
    --instance-ids "$instance" --document-name AWS-RunShellScript \
    --comment "$comment" --parameters "file://$(cygpath -m "$params")" \
    --query Command.CommandId --output text)
  rm -f "$params"
  echo "$comment: command $command_id sent, waiting…"

  # The CLI's waiter gives up after 100 s. Poll up to the command's own limit instead, so
  # expired credentials can't loop for ever.
  for _ in $(seq 1 $((timeout / 10))); do
    sleep 10
    status=$(aws ssm get-command-invocation --profile "$profile" --region "$region" \
      --command-id "$command_id" --instance-id "$instance" --query Status --output text) ||
      continue
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
}
