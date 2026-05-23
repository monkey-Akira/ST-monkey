#!/usr/bin/env bash
set -euo pipefail

MOD_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/release-common.sh
source "$MOD_ROOT/scripts/release-common.sh"

APP_ROOT="${1:-${ST_APP_ROOT:-$HOME/stc-app}}"
REPO="${ST_REPO:-https://github.com/SillyTavern/SillyTavern.git}"
REF="${ST_REF:-}"
PORT="${PORT:-8000}"
STAMP="$(stc_stamp)"

APP_ROOT="$(stc_abs_path "$APP_ROOT")"
RELEASES="$APP_ROOT/releases"
SHARED="$APP_ROOT/shared"
CURRENT="$(stc_current_release "$APP_ROOT" || true)"
RELEASE="$RELEASES/$STAMP"

echo "[STC-MOD] Updating app root: $APP_ROOT"
echo "[STC-MOD] Current release: ${CURRENT:-none}"
echo "[STC-MOD] New release: $RELEASE"

stc_require_tools

mkdir -p "$RELEASES" "$SHARED"

if [ -n "$CURRENT" ] && [ -d "$CURRENT/.git" ]; then
  echo "[STC-MOD] Cloning from current release local git copy..."
  git clone "$CURRENT" "$RELEASE"
  git -C "$RELEASE" remote set-url origin "$REPO" || true
  git -C "$RELEASE" fetch origin
  if [ -n "$REF" ]; then
    git -C "$RELEASE" checkout "$REF"
  else
    branch="$(git -C "$RELEASE" rev-parse --abbrev-ref HEAD)"
    git -C "$RELEASE" reset --hard "origin/$branch"
  fi
else
  echo "[STC-MOD] No current git release found. Fresh clone..."
  git clone "$REPO" "$RELEASE"
  if [ -n "$REF" ]; then
    git -C "$RELEASE" checkout "$REF"
  fi
fi

stc_link_shared_paths "$RELEASE" "$SHARED"

set +e
node "$MOD_ROOT/scripts/install.mjs" "$RELEASE"
install_status=$?
if [ "$install_status" -eq 0 ]; then
  npm --prefix "$RELEASE" install
  install_status=$?
fi
if [ "$install_status" -eq 0 ]; then
  node --check "$RELEASE/src/server-main.js"
  install_status=$?
fi
set -e

if [ "$install_status" -ne 0 ]; then
  echo "[STC-MOD] Update failed. Keeping current release unchanged." >&2
  echo "[STC-MOD] Failed release left for inspection: $RELEASE" >&2
  exit "$install_status"
fi

stc_write_start_script "$RELEASE" "$PORT"

if [ -n "$CURRENT" ]; then
  echo "$CURRENT" > "$APP_ROOT/.previous-release"
fi
stc_update_current_link "$APP_ROOT" "$RELEASE"
echo "$RELEASE" > "$APP_ROOT/.last-good-release"

echo
echo "[STC-MOD] Update applied."
echo "[STC-MOD] Current now points to:"
echo "  $RELEASE"
echo
echo "[STC-MOD] Restart your process/service to use the new release."
