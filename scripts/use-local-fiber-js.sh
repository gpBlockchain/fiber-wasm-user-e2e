#!/usr/bin/env bash
set -euo pipefail

FIBER_REPO="${FIBER_REPO:-https://github.com/nervosnetwork/fiber.git}"
FIBER_BRANCH="${FIBER_BRANCH:-fix/wasm-ckb-rpc-timeout}"
FIBER_JS_VERSION="${FIBER_JS_VERSION:-0.9.0-rc7}"
INSTALL_WASM_PACK="${INSTALL_WASM_PACK:-auto}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FIBER_DIR="${FIBER_DIR:-$APP_DIR/fiber}"
LOCAL_FIBER_JS_SPEC="${LOCAL_FIBER_JS_SPEC:-file:./fiber/fiber-js}"

usage() {
  cat <<EOF
Usage:
  scripts/use-local-fiber-js.sh
  scripts/use-local-fiber-js.sh --restore

Build a local Fiber checkout and point this app at its fiber-js package.

Environment:
  FIBER_REPO              Git repo to clone when ./fiber is missing.
                          Default: https://github.com/nervosnetwork/fiber.git
  FIBER_BRANCH            Fiber branch to checkout and build.
                          Default: fix/wasm-ckb-rpc-timeout
  FIBER_DIR               Local Fiber checkout path.
                          Default: ./fiber
  LOCAL_FIBER_JS_SPEC     npm file spec installed into this app.
                          Default: file:./fiber/fiber-js
  FIBER_JS_VERSION        Published version restored by --restore.
                          Default: 0.9.0-rc7
  INSTALL_WASM_PACK       auto, always, or skip.
                          Default: auto
EOF
}

log() {
  printf '\n==> %s\n' "$*"
}

run() {
  printf '+'
  printf ' %q' "$@"
  printf '\n'
  "$@"
}

restore_published_fiber_js() {
  log "Restoring @nervosnetwork/fiber-js@$FIBER_JS_VERSION"
  cd "$APP_DIR"
  run npm install "@nervosnetwork/fiber-js@$FIBER_JS_VERSION"
}

ensure_fiber_checkout() {
  if [[ ! -d "$FIBER_DIR/.git" ]]; then
    if [[ -e "$FIBER_DIR" ]]; then
      printf 'error: %s exists but is not a git checkout.\n' "$FIBER_DIR" >&2
      exit 1
    fi

    log "Cloning Fiber"
    run git clone "$FIBER_REPO" "$FIBER_DIR"
  fi

  cd "$FIBER_DIR"

  local origin_url
  origin_url="$(git remote get-url origin 2>/dev/null || true)"
  if [[ -n "$origin_url" && "$origin_url" != "$FIBER_REPO" ]]; then
    printf 'warning: existing Fiber checkout origin is %s, not %s\n' "$origin_url" "$FIBER_REPO" >&2
  fi

  if git show-ref --verify --quiet "refs/heads/$FIBER_BRANCH"; then
    log "Checking out existing local branch $FIBER_BRANCH"
    run git switch "$FIBER_BRANCH"
  else
    log "Fetching $FIBER_BRANCH"
    run git fetch origin "$FIBER_BRANCH:refs/remotes/origin/$FIBER_BRANCH"
    run git switch --track -c "$FIBER_BRANCH" "origin/$FIBER_BRANCH"
  fi
}

ensure_wasm_pack() {
  case "$INSTALL_WASM_PACK" in
    skip)
      log "Skipping wasm-pack install check"
      ;;
    auto)
      if command -v wasm-pack >/dev/null 2>&1; then
        log "wasm-pack is already installed"
      else
        log "Installing wasm-pack"
        run cargo install wasm-pack
      fi
      ;;
    always)
      log "Installing wasm-pack"
      run cargo install wasm-pack
      ;;
    *)
      printf 'error: INSTALL_WASM_PACK must be auto, always, or skip.\n' >&2
      exit 1
      ;;
  esac
}

build_fiber_js() {
  cd "$FIBER_DIR"

  log "Installing Fiber workspace dependencies"
  run npm install

  ensure_wasm_pack

  log "Building Fiber workspaces"
  run npm run build -ws

  if [[ ! -f "$FIBER_DIR/fiber-js/dist/index.js" ]]; then
    printf 'error: expected build output was not found: %s\n' "$FIBER_DIR/fiber-js/dist/index.js" >&2
    exit 1
  fi
}

use_local_fiber_js() {
  ensure_fiber_checkout
  build_fiber_js

  log "Installing local fiber-js into fiber-wasm-user-e2e"
  cd "$APP_DIR"
  run npm install "@nervosnetwork/fiber-js@$LOCAL_FIBER_JS_SPEC"

  log "Done"
  printf 'This app now depends on %s. Use --restore to switch back to @nervosnetwork/fiber-js@%s.\n' \
    "$LOCAL_FIBER_JS_SPEC" "$FIBER_JS_VERSION"
}

case "${1:-}" in
  "" )
    use_local_fiber_js
    ;;
  --restore )
    restore_published_fiber_js
    ;;
  -h | --help )
    usage
    ;;
  * )
    usage >&2
    exit 1
    ;;
esac
