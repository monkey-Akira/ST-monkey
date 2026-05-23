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
RELEASE="$RELEASES/$STAMP"

echo "[STC-MOD] Installer root: $MOD_ROOT"
echo "[STC-MOD] App root: $APP_ROOT"
echo "[STC-MOD] New release: $RELEASE"

stc_require_tools

mkdir -p "$RELEASES" "$SHARED"

echo "[STC-MOD] Cloning SillyTavern..."
git clone "$REPO" "$RELEASE"
if [ -n "$REF" ]; then
  git -C "$RELEASE" checkout "$REF"
fi

if [ -L "$APP_ROOT/current" ] && [ -d "$APP_ROOT/current" ]; then
  echo "[STC-MOD] Reusing shared data/config from existing installation."
else
  mkdir -p "$SHARED/config"
  if [ -f "$RELEASE/default/config.yaml" ]; then
    cp "$RELEASE/default/config.yaml" "$SHARED/config/config.yaml"
  fi
fi

stc_link_shared_paths "$RELEASE" "$SHARED"

node "$MOD_ROOT/scripts/install.mjs" "$RELEASE"

echo "[STC-MOD] Installing npm dependencies..."
npm --prefix "$RELEASE" install

stc_write_start_script "$RELEASE" "$PORT"
stc_update_current_link "$APP_ROOT" "$RELEASE"

cat > "$APP_ROOT/start.sh" <<EOF
#!/usr/bin/env bash
set -e
cd "\$(dirname "\${BASH_SOURCE[0]}")/current"
exec ./start-stc.sh
EOF
chmod +x "$APP_ROOT/start.sh"

echo "$RELEASE" > "$APP_ROOT/.last-good-release"

echo
echo "[STC-MOD] Done."
echo "[STC-MOD] Start with:"
echo "  cd \"$APP_ROOT\""
echo "  ./start.sh"
echo
echo "[STC-MOD] Default URL:"
echo "  http://YOUR_SERVER_IP:$PORT/"
