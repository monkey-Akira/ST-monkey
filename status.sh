#!/usr/bin/env bash
set -euo pipefail

MOD_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/release-common.sh
source "$MOD_ROOT/scripts/release-common.sh"

APP_ROOT="${1:-${ST_APP_ROOT:-$HOME/stc-app}}"
APP_ROOT="$(stc_abs_path "$APP_ROOT")"
CURRENT="$(stc_current_release "$APP_ROOT" || true)"

echo "[STC-MOD] App root: $APP_ROOT"
echo "[STC-MOD] Current release: ${CURRENT:-none}"

if [ -n "$CURRENT" ] && [ -d "$CURRENT/.git" ]; then
  echo "[STC-MOD] SillyTavern commit: $(git -C "$CURRENT" rev-parse --short HEAD)"
  echo "[STC-MOD] SillyTavern branch: $(git -C "$CURRENT" rev-parse --abbrev-ref HEAD)"
fi

if [ -f "$APP_ROOT/.previous-release" ]; then
  echo "[STC-MOD] Previous release: $(cat "$APP_ROOT/.previous-release")"
fi

if [ -f "$APP_ROOT/.last-good-release" ]; then
  echo "[STC-MOD] Last good release: $(cat "$APP_ROOT/.last-good-release")"
fi

echo
echo "[STC-MOD] Releases:"
if [ -d "$APP_ROOT/releases" ]; then
  ls -1 "$APP_ROOT/releases"
else
  echo "(none)"
fi

echo
echo "[STC-MOD] Shared paths:"
for name in config data plugins extensions; do
  path="$APP_ROOT/shared/$name"
  if [ -e "$path" ]; then
    echo "  $name: $path"
  else
    echo "  $name: missing"
  fi
done
