#!/usr/bin/env bash
# Prints the commit the demo server runs now (its release.env), or nothing on a server that
# has never had a release. The deploy workflow reads it before deploying: it is the release
# to roll back to (stage 6).
#   scripts/deploy/current-release.sh
# Needs AWS credentials (scripts/deploy/lib.sh) and the server running.
set -euo pipefail
# shellcheck source=scripts/deploy/lib.sh
source "$(dirname "$0")/lib.sh"

output=$(run_on_server "current release" 60 \
  'cat /opt/business-software/release.env 2>/dev/null || true')
# Only a full commit hash counts: anything else in the output is run_on_server's own lines.
sed -n 's/^IMAGE_TAG=\([0-9a-f]\{40\}\)$/\1/p' <<<"$output" | tail -n 1
