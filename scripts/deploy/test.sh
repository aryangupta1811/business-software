#!/usr/bin/env bash
# Tests for the deploy scripts' own logic, with no AWS and no network (stage 6):
#   scripts/deploy/test.sh
# Runs in CI's check job (Linux) and on the laptop (Git Bash). Each test builds what it needs
# in a temporary folder: a small git repository standing in for this one, or a fake `curl`
# standing in for the live site.
set -uo pipefail

here=$(cd "$(dirname "$0")" && pwd)
readonly here
work=$(mktemp -d)
readonly work
trap 'rm -rf "$work"' EXIT

passed=0
failed=0

ok() {
  echo "ok: $1"
  passed=$((passed + 1))
}

not_ok() {
  echo "NOT OK: $1" >&2
  [[ -z ${2:-} ]] || echo "  $2" >&2
  failed=$((failed + 1))
}

# expect <exit code> <name> <command>...: runs the command, keeps its output in $out.
expect() {
  local want=$1 name=$2 got
  shift 2
  out=$("$@" 2>&1)
  got=$?
  if [[ $got == "$want" ]]; then ok "$name"; else not_ok "$name" "exit $got, wanted $want: $out"; fi
}

# expect_output <name> <pattern>: the last command's output matches the pattern (grep -E).
expect_output() {
  if grep -Eq -- "$2" <<<"$out"; then ok "$1"; else not_ok "$1" "no '$2' in: $out"; fi
}

# expect_equal <name> <got> <wanted>
expect_equal() {
  if [[ $2 == "$3" ]]; then ok "$1"; else not_ok "$1" "got '$2', wanted '$3'"; fi
}

# --- A repository like this one: main has a <- b <- c; "side" branches off a. ---------------
repo=$work/repo
git init -q -b main "$repo"
commit() { git -C "$repo" -c user.name=t -c user.email=t@t commit -q --allow-empty -m "$1"; }
commit a
a=$(git -C "$repo" rev-parse HEAD)
commit b
b=$(git -C "$repo" rev-parse HEAD)
commit c
c=$(git -C "$repo" rev-parse HEAD)
git -C "$repo" switch -q -c side "$a"
commit side
side=$(git -C "$repo" rev-parse HEAD)
git -C "$repo" switch -q main
# demo.sh and the workflow check against origin/main, the remote's copy of main.
git -C "$repo" update-ref refs/remotes/origin/main "$c"

# Runs a lib.sh function inside the test repository.
in_repo() {
  # shellcheck source=scripts/deploy/lib.sh
  (cd "$repo" && source "$here/lib.sh" && "$@")
}

# --- main_commit: one check for "a commit on main", used by demo.sh and the workflow. ---------
expect 0 "main_commit: a short hash on main gives the full hash" in_repo main_commit "${b:0:7}"
expect_equal "main_commit: prints only the hash" "$out" "$b"
expect 0 "main_commit: origin/main" in_repo main_commit origin/main
expect_equal "main_commit: origin/main is the newest" "$out" "$c"
expect 1 "main_commit: refuses a commit that isn't on main" in_repo main_commit "$side"
expect_output "main_commit: says why" "is not on origin/main"
expect 1 "main_commit: refuses a name that isn't a commit" in_repo main_commit no-such-thing

# --- not_older_than_running: images runs can finish out of order. ---------------------------
expect 0 "order: first release (nothing running)" in_repo not_older_than_running "$b" ""
expect 0 "order: newer than the running release" in_repo not_older_than_running "$c" "$b"
expect 0 "order: the same release again (a rerun)" in_repo not_older_than_running "$b" "$b"
expect 1 "order: refuses a release older than the running one" in_repo not_older_than_running "$a" "$c"
expect_output "order: names both commits" "${a:0:12}.*${c:0:12}"
expect 0 "order: running release unknown here (not in this history)" \
  in_repo not_older_than_running "$c" 0123456789abcdef0123456789abcdef01234567
expect_output "order: warns when the running release is unknown" "not in this repository"

# --- check-live.sh: retries, with no wait after the last try. -------------------------------
# A fake curl answering like the live site, except that its first $DOWN calls fail as if the
# server were still starting. Calls are counted in a file.
fake=$work/bin
mkdir -p "$fake"
cat >"$fake/curl" <<'FAKE'
#!/usr/bin/env bash
n=$(($(cat "$CALLS" 2>/dev/null || echo 0) + 1))
echo "$n" >"$CALLS"
if ((n <= DOWN)); then
  echo "curl: (7) Failed to connect" >&2
  exit 7
fi
url=${!#}
case " $* " in
  *" -I "*)
    case $url in
      http://*) printf 'HTTP/1.1 308 Permanent Redirect\r\nLocation: https://%s\r\n\r\n' "${url#http://}" ;;
      */assets/missing.js) printf 'HTTP/2 404\r\ncache-control: no-store\r\nstrict-transport-security: max-age=31536000\r\n\r\n' ;;
      */favicon.ico) printf 'HTTP/2 200\r\ncontent-type: image/x-icon\r\n\r\n' ;;
      *) printf 'HTTP/2 200\r\ncache-control: no-cache\r\ncontent-security-policy: x\r\nstrict-transport-security: max-age=31536000\r\n\r\n' ;;
    esac
    ;;
  *"%{http_code}"*) printf '200 application/json' ;;
  *)
    [[ -z ${TIMING_FAILS:-} ]] || { echo "curl: (28) Operation timed out" >&2; exit 28; }
    echo "time: fake"
    ;;
esac
FAKE
chmod +x "$fake/curl"

live() {
  local down=$1
  shift
  rm -f "$work/calls"
  PATH="$fake:$PATH" CALLS=$work/calls DOWN=$down CHECK_LIVE_DELAY=0 \
    "$here/check-live.sh" "$@" https://demo.example
}

expect 0 "check-live: a healthy site passes" live 0
expect_output "check-live: checks every part" "ok: http redirects to https"
expect 1 "check-live: one try by default" live 1
expect 0 "check-live: a site that comes up on the second try passes" live 1 --tries 3
expect_output "check-live: reports the failed try" "try 1 of 3 failed"
expect 1 "check-live: a site that stays down fails after the last try" live 999 --tries 3
expect_output "check-live: reports the last try" "try 3 of 3 failed"
expect_equal "check-live: no wait after the last try" "$(grep -c 'trying again' <<<"$out")" 2
expect 2 "check-live: refuses a bad --tries" live 0 --tries zero
TIMING_FAILS=1 expect 0 "check-live: a failed timing request (only informational) passes" live 0

# --- run_on_server and wait_for_command: Run Command through a fake AWS CLI. ----------------
# The fake answers send-command with a command ID and keeps what was sent; each Status query
# takes the next line of $STATUSES ("ERR:<message>" fails like the CLI does).
cat >"$fake/aws" <<'FAKE'
#!/usr/bin/env bash
args=" $* "
case $args in
  *" send-command "*)
    params=${args##*--parameters file://}
    cp "${params%% *}" "$SENT"
    echo cmd-1
    ;;
  *" get-command-invocation "*"--query Status"*)
    line=$(head -n 1 "$STATUSES")
    [[ -z $line ]] && line=InProgress || sed -i 1d "$STATUSES"
    if [[ $line == ERR:* ]]; then
      echo "${line#ERR:}" >&2
      exit 254
    fi
    echo "$line"
    ;;
  *" get-command-invocation "*)
    echo '{"StandardOutputContent": "out from server", "StandardErrorContent": ""}'
    ;;
  *) echo "fake aws: unexpected call: $*" >&2; exit 99 ;;
esac
FAKE
chmod +x "$fake/aws"

# The environment for scripts run against the fake AWS CLI: $1 holds the Status answers, one
# word each. GITHUB_OUTPUT points at a file of this test's own, also when CI runs it.
fake_aws_env() {
  tr ' ' '\n' <<<"$1" >"$work/statuses"
  rm -f "$work/sent.json" "$work/github-output"
  export PATH="$fake:$PATH" STATUSES=$work/statuses SENT=$work/sent.json \
    GITHUB_OUTPUT=$work/github-output DEMO_INSTANCE_ID=i-0123456789abcdef0 RUN_POLL_SECONDS=0
}

# server <status answers> -- <command>...: runs a lib.sh function against the fake AWS CLI.
server() {
  local answers=$1
  shift 2
  (
    fake_aws_env "$answers"
    # shellcheck source=scripts/deploy/lib.sh
    source "$here/lib.sh"
    "$@"
  )
}

expect 0 "run_on_server: waits while the command runs, then succeeds" \
  server "Pending InProgress Success" -- run_on_server test 60 'echo hi'
expect_output "run_on_server: prints the server's output" "out from server"
expect_output "run_on_server: prints the final status" "status: Success"
expect_equal "run_on_server: gives the command ID to the next workflow step" \
  "$(cat "$work/github-output")" "command_id=cmd-1"
expect 0 "run_on_server: retries while the invocation doesn't exist yet" \
  server "ERR:An_error_(InvocationDoesNotExist) Success" -- run_on_server test 60 'echo hi'
expect 0 "run_on_server: retries when throttled" \
  server "ERR:An_error_(ThrottlingException) Success" -- run_on_server test 60 'echo hi'
expect 1 "run_on_server: stops at once on an auth error" \
  server "ERR:An_error_(ExpiredTokenException) Success" -- run_on_server test 60 'echo hi'
expect_output "run_on_server: reports the auth error" "ExpiredTokenException"
expect 1 "run_on_server: a failed command fails" \
  server "InProgress Failed" -- run_on_server test 60 'false'
expect 2 "wait_for_command: still running at the deadline" \
  server "InProgress" -- wait_for_command cmd-1 i-0123456789abcdef0 0
expect_output "wait_for_command: says it is still running" "still InProgress"
expect 1 "wait_for_command: a finished failed command" \
  server "Failed" -- wait_for_command cmd-1 i-0123456789abcdef0 60

# --- backup.sh before-deploy: never deploys without a fresh backup unless told to. ----------
backup() {
  (
    fake_aws_env Success
    "$here/backup.sh" "$@"
  )
}
expect 0 "backup: before-deploy sends the backup" backup before-deploy
out=$(cat "$work/sent.json")
expect_output "backup: before-deploy fails on the server when there's no backup service" \
  "no backup service.*exit 1"
expect 0 "backup: before-deploy --first-backup-release sends the backup" backup before-deploy --first-backup-release
out=$(cat "$work/sent.json")
expect_output "backup: --first-backup-release skips only a missing backup service" "skipped.*exit 0"
expect 2 "backup: refuses an unknown option" backup before-deploy --yes

# --- deploy/demo/mail-credentials.sh: the api's mail-only credentials (ADR 0040 note). -------
# Linux only (CI and the server): Git Bash can't set file modes or groups in its temp folder.
if [[ $(uname -s) != Linux ]]; then
  echo "skipped: mail-credentials.sh tests need Linux (CI runs them)"
else
# A fake AWS CLI of its own: $MAIL_ROLE is what SSM holds ("" = nothing), $MAIL_ASSUME is ok
# or fail. The real CLI shapes the JSON with --query; the fake prints that shape and records
# the call, so the test can check what was asked for.
mailbin=$work/mailbin
mkdir -p "$mailbin"
cat >"$mailbin/aws" <<'FAKE'
#!/usr/bin/env bash
args=" $* "
case $args in
  *" ssm get-parameter "*"/business-software/demo/mail/role-arn "*)
    [[ -n $MAIL_ROLE ]] || { echo "An error occurred (ParameterNotFound)" >&2; exit 254; }
    echo "$MAIL_ROLE"
    ;;
  *" sts assume-role "*)
    echo "$*" >"$MAIL_CALLS"
    [[ $MAIL_ASSUME == ok ]] || { echo "An error occurred (AccessDenied)" >&2; exit 254; }
    printf '{"Version": 1, "AccessKeyId": "ASIAFAKE", "SecretAccessKey": "s3cr3t-fake", "SessionToken": "tok", "Expiration": "2030-01-01T00:00:00+00:00"}\n'
    ;;
  *) echo "fake aws: unexpected call: $*" >&2; exit 99 ;;
esac
FAKE
chmod +x "$mailbin/aws"
maildir=$work/mail
mail_credentials() {
  MAIL_AWS=$mailbin/aws MAIL_DIR=$maildir MAIL_GROUP=$(id -g) MAIL_CALLS=$work/mail-calls \
    MAIL_ROLE=$1 MAIL_ASSUME=$2 "$here/../../deploy/demo/mail-credentials.sh"
}
role=arn:aws:iam::123456789012:role/business-software-demo-mail

expect 0 "mail: writes the credentials" mail_credentials "$role" ok
if grep -q '"SecretAccessKey"' <<<"$out"; then
  not_ok "mail: never prints the credentials" "$out"
else
  ok "mail: never prints the credentials"
fi
out=$(cat "$maildir/credentials.json")
expect_output "mail: credential_process shape, Version the number 1" '"Version": 1,.*"AccessKeyId": "ASIAFAKE"'
out=$(cat "$work/mail-calls")
expect_output "mail: assumes the role from SSM for 1 hour" "--role-arn $role .*--duration-seconds 3600"
out=$(cat "$maildir/config")
expect_output "mail: the config points the SDK at the file" '^credential_process = cat /aws/credentials.json$'
if [[ $(uname -s) == Linux ]]; then
  expect_equal "mail: only root and the api's group can read the credentials" \
    "$(stat -c %a "$maildir/credentials.json") $(stat -c %a "$maildir")" "640 750"
fi
expect 254 "mail: a failed assume-role fails with the CLI's code" mail_credentials "$role" fail
expect_output "mail: reports AWS's error" "AccessDenied"
out=$(cat "$maildir/credentials.json")
expect_output "mail: a failed refresh leaves the last good credentials" "ASIAFAKE"
expect_equal "mail: a failed refresh leaves no temporary file" \
  "$(find "$maildir" -name '.credentials.*' | wc -l | tr -d ' ')" 0
expect 254 "mail: no role in SSM fails" mail_credentials "" ok
expect 1 "mail: refuses a value that isn't a role ARN" mail_credentials None ok
expect_output "mail: says what's missing" "no mail role in SSM"
fi

echo "$passed passed, $failed failed"
((failed == 0))
