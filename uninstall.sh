#!/bin/sh
# Removes the RexyCamp toggle, its key, and its settings from Rex.
set -eu

init_file=${REX_CONFIG:-${XDG_CONFIG_HOME:-$HOME/.config}/rex/init.lua}
config_dir=$(dirname -- "$init_file")
require_line='require("rexycamp")'

# The require line goes first, so a failure never leaves init.lua requiring a lost file.
if [ -e "$init_file" ]; then
  remaining_lines=$(grep -vF "$require_line" "$init_file" || true)
  printf '%s\n' "$remaining_lines" > "$init_file"
fi
rm -f "$config_dir/rexycamp.lua" "$config_dir/rexycamp_toggle.lua"
echo "removed the RexyCamp action, its key, and its settings from Rex"

if rex config reload >/dev/null 2>&1; then
  echo "reloaded Rex's config"
else
  echo "reload Rex's config yourself: rex config reload" >&2
fi
