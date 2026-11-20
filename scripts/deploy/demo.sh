#!/usr/bin/env bash
# Deploys a commit of main to the demo server, from the laptop (Git Bash) or the deploy
# workflow (stage 6, .github/workflows/deploy.yml):
#   scripts/deploy/demo.sh [commit]        default: origin/main
# Needs AWS credentials (scripts/deploy/lib.sh), the server and RDS running, and the images
# for that commit on GHCR (the images workflow smoke-tests and pushes them for every commit on
# main).
#
# How: Systems Manager Run Command tells the server to download this repo at exactly that
# commit from GitHub, then run deploy/demo/install.sh from it. No SSH, no open port, and the
# server runs only files that are in the public history.
set -euo pipefail
# shellcheck source=scripts/deploy/lib.sh
source "$(dirname "$0")/lib.sh"

readonly repo=aryangupta1811/business-software

sha=$(main_commit "${1:-origin/main}")

# Needs Docker Desktop running; works without a login once the packages are public.
for image in business-software-app business-software-web; do
  docker manifest inspect "ghcr.io/aryangupta1811/$image:$sha" >/dev/null || {
    echo "ghcr.io/aryangupta1811/$image:$sha: not found (images workflow not run yet," \
      "package still private, or Docker not running)" >&2
    exit 1
  }
done

# Plain sh on the server (Run Command's shell): download, unpack only what's needed, run.
# Up to 15 minutes: a first deploy pulls images.
# shellcheck disable=SC2016 # $tmp is expanded by the server's shell, not here
run_on_server "deploy ${sha:0:12}" 900 \
  'set -eu' \
  'tmp=$(mktemp -d)' \
  "trap 'rm -rf \$tmp' EXIT" \
  "curl -fsSL --max-time 60 -o \$tmp/src.tar.gz https://codeload.github.com/$repo/tar.gz/$sha" \
  "tar -xzf \$tmp/src.tar.gz -C \$tmp --strip-components=1 --wildcards '*/deploy/demo/*' '*/packages/db/bootstrap/*.sql'" \
  "bash \$tmp/deploy/demo/install.sh $sha"
