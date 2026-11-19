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
  *) echo "time: fake" ;;
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

echo "$passed passed, $failed failed"
((failed == 0))
