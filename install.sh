#!/bin/sh
# Builds RexyCamp, installs its toggle into Rex's config directory, and reloads Rex.
set -eu

plugin_dir=$(cd -- "$(dirname -- "$0")" && pwd)
init_file=${REX_CONFIG:-${XDG_CONFIG_HOME:-$HOME/.config}/rex/init.lua}
config_dir=$(dirname -- "$init_file")
settings_file=$config_dir/rexycamp.lua
toggle_file=$config_dir/rexycamp_toggle.lua
require_line='require("rexycamp")'
rexycamp_bin=$plugin_dir/dist/rexycamp

find_binary() {
  binary_name=$1
  override=$2
  install_hint=$3
  binary_path=${override:-$(command -v "$binary_name" || true)}
  if [ -z "$binary_path" ]; then
    echo "$binary_name is not on PATH. $install_hint" >&2
    exit 1
  fi
  printf '%s' "$binary_path"
}

lua_quoted() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

basecamp_bin=$(find_binary basecamp "${BASECAMP_BIN:-}" "Install it (brew install --cask basecamp/tap/basecamp-cli) or set BASECAMP_BIN.")
rex_bin=$(find_binary rex "${REX_BIN:-}" "Install Rex or set REX_BIN.")
claude_bin=$(find_binary claude "${CLAUDE_BIN:-}" "Install Claude Code or set CLAUDE_BIN.")
bun_bin=$(find_binary bun "${BUN_BIN:-}" "Install it (brew install bun) or set BUN_BIN.")

(cd "$plugin_dir" && "$bun_bin" build src/main.ts --compile --outfile "$rexycamp_bin" >/dev/null)
echo "built $rexycamp_bin"

mkdir -p "$config_dir"

{
  echo "-- install.sh of RexyCamp writes this file. Do not edit it. Your settings are in rexycamp.lua."
  echo "local REXYCAMP_BIN = \"$(lua_quoted "$rexycamp_bin")\""
  echo "local BASECAMP_BIN = \"$(lua_quoted "$basecamp_bin")\""
  echo "local REX_BIN = \"$(lua_quoted "$rex_bin")\""
  echo "local CLAUDE_BIN = \"$(lua_quoted "$claude_bin")\""
  echo
  cat "$plugin_dir/lua/rexycamp_toggle.lua"
} > "$toggle_file"
echo "wrote $toggle_file"

if [ -e "$settings_file" ]; then
  echo "kept your settings in $settings_file"
else
  cp "$plugin_dir/lua/rexycamp.lua" "$settings_file"
  echo "wrote $settings_file with your settings"
fi

if ! grep -qF "$require_line" "$init_file" 2>/dev/null; then
  if [ -s "$init_file" ] && [ -n "$(tail -c 1 "$init_file")" ]; then
    echo >> "$init_file"
  fi
  echo "$require_line" >> "$init_file"
  echo "added $require_line to $init_file"
fi

if rex config reload >/dev/null 2>&1; then
  echo "reloaded Rex's config"
else
  echo "reload Rex's config yourself: rex config reload" >&2
fi
echo "press cmd+b, or run \"Toggle RexyCamp\" from the command palette"
