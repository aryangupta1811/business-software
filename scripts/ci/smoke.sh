#!/usr/bin/env bash
# Smoke test of the real images, run by CI after `docker compose up -d --wait`.
# Locally (Git Bash, after `pnpm app:up`): scripts/ci/smoke.sh. It stops the containers at the end.
# Check 7 is why this runs in CI: Windows can't send containers a real stop signal.
set -euo pipefail

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

# Prints the status code, then the response headers in lowercase.
head_request() {
  { curl -sS --max-time 15 -I "$1" || true; } | tr -d '\r' | tr '[:upper:]' '[:lower:]'
}

expect_header() {
  local headers=$1 url=$2 header=$3
  grep -q "^$header" <<<"$headers" || fail "$url: expected header '$header', got:"$'\n'"$headers"
}

expect_status() {
  local headers=$1 url=$2 status=$3
  [[ $(head -n 1 <<<"$headers") == "http/"*" $status"* ]] ||
    fail "$url: expected status $status, got: $(head -n 1 <<<"$headers")"
}

# 1. The API itself, with the database.
url=http://127.0.0.1:3000/api/health/ready
got=$(curl -sS --max-time 15 -o /dev/null -w '%{http_code}' "$url" || true)
[[ $got == 200 ]] || fail "$url: expected 200, got $got"
echo "ok: api ready"

# 2. The same call through Caddy.
url=http://127.0.0.1:8080/api/health/ready
got=$(curl -sS --max-time 15 -o /dev/null -w '%{http_code} %{content_type}' "$url" || true)
[[ $got == "200 application/json"* ]] || fail "$url: expected 200 application/json, got $got"
echo "ok: api ready through caddy"

# 3. The app's page: checked on every load, and locked down by the CSP.
url=http://127.0.0.1:8080/
headers=$(head_request "$url")
expect_status "$headers" "$url" 200
expect_header "$headers" "$url" 'cache-control: no-cache'
expect_header "$headers" "$url" 'content-security-policy: '
echo "ok: / is no-cache with a csp"

# 4. A deep link gets the app (the router shows its own not-found page).
url=http://127.0.0.1:8080/no-such-page
expect_status "$(head_request "$url")" "$url" 200
echo "ok: deep link served"

# 5. A missing asset is a real 404 that no browser keeps.
url=http://127.0.0.1:8080/assets/missing.js
headers=$(head_request "$url")
expect_status "$headers" "$url" 404
expect_header "$headers" "$url" 'cache-control: no-store'
echo "ok: missing asset is 404 no-store"

# 5b. The favicon is a real file, not the app's HTML from the SPA fallback.
url=http://127.0.0.1:8080/favicon.ico
headers=$(head_request "$url")
expect_status "$headers" "$url" 200
expect_header "$headers" "$url" 'content-type: image/'
echo "ok: favicon is an image"

# 6. A migration with a wrong password fails (exit 1), so api and worker would never start.
set +e
docker compose run --rm --no-deps \
  -e MIGRATION_DATABASE_URL=postgresql://app_owner:wrong@db:5432/business_software migrate
got=$?
set -e
[[ $got == 1 ]] || fail "migrate with a wrong password: expected exit 1, got $got"
echo "ok: migrate with a wrong password exits 1"

# 7. A clean stop: each long-running service exits 0 on Docker's stop signal.
docker compose stop
for service in api worker web; do
  got=$(docker inspect -f '{{.State.ExitCode}}' "$(docker compose ps -a -q "$service")")
  [[ $got == 0 ]] || fail "$service: expected exit 0 after docker compose stop, got $got"
done
echo "ok: api, worker and web exit 0 on stop"
