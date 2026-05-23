#!/usr/bin/env bash
set -euo pipefail

MOD_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/release-common.sh
source "$MOD_ROOT/scripts/release-common.sh"

APP_ROOT="${1:-${ST_APP_ROOT:-$HOME/stc-app}}"
APP_ROOT="$(stc_abs_path "$APP_ROOT")"
TARGET_RELEASE="${2:-}"

if [ -z "$TARGET_RELEASE" ]; then
  if [ -f "$APP_ROOT/.previous-release" ]; then
    TARGET_RELEASE="$(cat "$APP_ROOT/.previous-release")"
  else
    echo "[STC-MOD] ERROR: no previous release recorded." >&2
    echo "[STC-MOD] Available releases:" >&2
    ls -1 "$APP_ROOT/releases" >&2 || true
    exit 1
  fi
fi

if [ ! -d "$TARGET_RELEASE" ]; then
  if [ -d "$APP_ROOT/releases/$TARGET_RELEASE" ]; then
    TARGET_RELEASE="$APP_ROOT/releases/$TARGET_RELEASE"
  else
    echo "[STC-MOD] ERROR: release not found: $TARGET_RELEASE" >&2
    exit 1
  fi
fi

CURRENT="$(stc_current_release "$APP_ROOT" || true)"
if [ -n "$CURRENT" ]; then
  echo "$CURRENT" > "$APP_ROOT/.previous-release"
fi

stc_update_current_link "$APP_ROOT" "$TARGET_RELEASE"
echo "$TARGET_RELEASE" > "$APP_ROOT/.last-good-release"

echo "[STC-MOD] Rolled back current release to:"
echo "  $TARGET_RELEASE"
echo
echo "[STC-MOD] Restart your process/service to use the rolled back release."
