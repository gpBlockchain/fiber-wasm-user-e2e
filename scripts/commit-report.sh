#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="${REPORT_REPO_ROOT:-$(cd "$here/.." && pwd)}"
cd "$root"

REMOTE="${REPORT_REMOTE:-origin}"
BRANCH="${REPORT_BRANCH:-${GITHUB_REF_NAME:-main}}"

git config user.name "${GIT_AUTHOR_NAME:-github-actions[bot]}"
git config user.email "${GIT_AUTHOR_EMAIL:-41898282+github-actions[bot]@users.noreply.github.com}"

echo "commit-report: event=${GITHUB_EVENT_NAME:-local} attempt=${GITHUB_RUN_ATTEMPT:-n/a} ref=${GITHUB_REF:-n/a} sha=${GITHUB_SHA:-n/a} remote=${REMOTE} branch=${BRANCH}"

git add public/reports
if git diff --cached --quiet; then
  echo "No report changes to commit."
  exit 0
fi

git commit -m "Add daily Fiber WASM scenario report"

rebase_onto_remote() {
  if [ "$(git rev-parse --is-shallow-repository)" = "true" ]; then
    git fetch --unshallow "$REMOTE" || git fetch --deepen=100 "$REMOTE"
  fi
  git fetch "$REMOTE" "$BRANCH"

  if git rebase "$REMOTE/$BRANCH"; then
    return 0
  fi

  local conflicted
  conflicted="$(git diff --name-only --diff-filter=U || true)"
  echo "Rebase conflicts:"
  printf '%s\n' "$conflicted"

  if [ -z "$conflicted" ]; then
    echo "git rebase failed without recorded conflicts" >&2
    git rebase --abort || true
    return 1
  fi

  local unexpected
  unexpected="$(printf '%s\n' "$conflicted" | grep -v '^public/reports/index.json$' || true)"
  if [ -n "$unexpected" ]; then
    echo "Refusing to auto-resolve unexpected conflict paths:" >&2
    printf '%s\n' "$unexpected" >&2
    git rebase --abort || true
    return 1
  fi

  node "$here/rebuild-report-index.mjs"
  git add public/reports/index.json
  GIT_EDITOR=true git -c core.editor=true rebase --continue
}

push_with_rebase() {
  local max="${REPORT_PUSH_RETRIES:-3}"
  local i
  for i in $(seq 1 "$max"); do
    rebase_onto_remote
    # Never force-push.
    if git push "$REMOTE" "HEAD:$BRANCH"; then
      echo "Pushed report commit to ${REMOTE}/${BRANCH}"
      return 0
    fi
    echo "git push failed (attempt ${i}/${max}); fetching and rebasing before retry"
  done

  echo "git push failed after ${max} attempts" >&2
  return 1
}

push_with_rebase
