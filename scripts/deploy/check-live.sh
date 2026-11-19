#!/usr/bin/env bash
# Checks the live demo site from outside, after a deploy or a server start:
#   scripts/deploy/check-live.sh [--tries N] [base URL]
#     --tries N   try up to N times, 15 s apart, until every check passes (default 1). The
#                 deploy workflow uses 3: Caddy and the API can need a moment after a restart,
#                 and a needless rollback costs more than the wait.
#     base URL    default: https://business-software.duckdns.org
# The same header checks as scripts/ci/smoke.sh, plus what only exists live: a trusted
# certificate, the redirect from HTTP, and HSTS. Tests: scripts/deploy/test.sh.
set -euo pipefail

tries=1
if [[ ${1:-} == --tries ]]; then
  [[ ${2:-} =~ ^[1-9][0-9]*$ ]] || { echo "usage: check-live.sh [--tries N] [base URL]" >&2; exit 2; }
  tries=$2
  shift 2
fi
readonly tries base=${1:-https://business-software.duckdns.org}
readonly host=${base#https://}
# Seconds between tries; the tests set 0.
readonly delay=${CHECK_LIVE_DELAY:-15}

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

# Prints the status line, then the response headers in lowercase. curl checks the
# certificate (no -k), so an untrusted or wrong certificate fails here.
head_request() {
  { curl -sS --max-time 15 -I "$1" || true; } | tr -d '\r' | tr '[:upper:]' '[:lower:]'
}

expect_header() {
  grep -q "^$3" <<<"$1" || fail "$2: expected header '$3', got:"$'\n'"$1"
}

expect_status() {
  [[ $(head -n 1 <<<"$1") == "http/"*" $3"* ]] || fail "$2: expected status $3, got: $(head -n 1 <<<"$1")"
}

# Every check once. fail() exits, so this runs in a subshell: a failed check ends the try,
# not the script.
check_once() {
  # 1. The API with its database, through Caddy, over HTTPS with a trusted certificate.
  url=$base/api/health/ready
  got=$(curl -sS --max-time 15 -o /dev/null -w '%{http_code} %{content_type}' "$url" || true)
  [[ $got == "200 application/json"* ]] || fail "$url: expected 200 application/json, got $got"
  echo "ok: api ready over https"

  # 2. The app's page: no-cache, the CSP, and HSTS.
  url=$base/
  headers=$(head_request "$url")
  expect_status "$headers" "$url" 200
  expect_header "$headers" "$url" 'cache-control: no-cache'
  expect_header "$headers" "$url" 'content-security-policy: '
  expect_header "$headers" "$url" 'strict-transport-security: max-age=31536000'
  echo "ok: / is no-cache with a csp and hsts"

  # 3. A missing asset is a real 404 that no browser keeps, and keeps the headers.
  url=$base/assets/missing.js
  headers=$(head_request "$url")
  expect_status "$headers" "$url" 404
  expect_header "$headers" "$url" 'cache-control: no-store'
  expect_header "$headers" "$url" 'strict-transport-security: '
  echo "ok: missing asset is 404 no-store with hsts"

  # 4. The favicon is a real file.
  url=$base/favicon.ico
  headers=$(head_request "$url")
  expect_status "$headers" "$url" 200
  expect_header "$headers" "$url" 'content-type: image/'
  echo "ok: favicon is an image"

  # 5. Plain HTTP answers only with a permanent redirect to HTTPS.
  url=http://$host/some/page
  headers=$(head_request "$url")
  expect_status "$headers" "$url" 308
  expect_header "$headers" "$url" "location: https://$host/some/page"
  echo "ok: http redirects to https"
}

for ((try = 1; ; try++)); do
  (check_once) && break
  echo "try $try of $tries failed" >&2
  ((try < tries)) || exit 1
  echo "trying again in $delay s" >&2
  sleep "$delay"
done

# 6. Timing from here (the owner's laptop is in India), for the record.
curl -sS -o /dev/null --max-time 15 \
  -w 'time: dns %{time_namelookup}s, connect %{time_connect}s, tls %{time_appconnect}s, first byte %{time_starttransfer}s, total %{time_total}s\n' \
  "$base/"
