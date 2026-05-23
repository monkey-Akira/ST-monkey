#!/usr/bin/env bash

stc_require_tools() {
  for tool in git node npm; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      echo "[STC-MOD] ERROR: missing required command: $tool" >&2
      exit 1
    fi
  done
}

stc_stamp() {
  date +"%Y%m%d-%H%M%S"
}

stc_abs_path() {
  local input="$1"
  mkdir -p "$input"
  cd "$input"
  pwd
}

stc_link_shared_paths() {
  local release_dir="$1"
  local shared_dir="$2"

  mkdir -p "$shared_dir/data" "$shared_dir/plugins" "$shared_dir/extensions" "$shared_dir/config"

  if [ -f "$release_dir/config.yaml" ] && [ ! -f "$shared_dir/config/config.yaml" ]; then
    cp "$release_dir/config.yaml" "$shared_dir/config/config.yaml"
  fi

  rm -rf "$release_dir/data"
  ln -sfn "$shared_dir/data" "$release_dir/data"

  rm -rf "$release_dir/plugins"
  ln -sfn "$shared_dir/plugins" "$release_dir/plugins"

  mkdir -p "$release_dir/public/scripts/extensions"
  rm -rf "$release_dir/public/scripts/extensions/third-party"
  ln -sfn "$shared_dir/extensions" "$release_dir/public/scripts/extensions/third-party"

  rm -f "$release_dir/config.yaml"
  ln -sfn "$shared_dir/config/config.yaml" "$release_dir/config.yaml"
}

stc_write_start_script() {
  local release_dir="$1"
  local port="$2"

  cat > "$release_dir/start-stc.sh" <<EOF
#!/usr/bin/env bash
set -e
cd "\$(dirname "\${BASH_SOURCE[0]}")"
PORT="\${PORT:-$port}"
node server.js --host 0.0.0.0 --port "\$PORT"
EOF
  chmod +x "$release_dir/start-stc.sh"
}

stc_update_current_link() {
  local app_root="$1"
  local release_dir="$2"
  ln -sfn "$release_dir" "$app_root/current"
}

stc_current_release() {
  local app_root="$1"
  if [ -L "$app_root/current" ]; then
    readlink "$app_root/current"
  fi
}
