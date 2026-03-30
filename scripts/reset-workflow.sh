#!/usr/bin/env bash
set -euo pipefail
# Reset devt workflow state — delegates to devt-tools.cjs for robust cleanup
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if command -v node >/dev/null 2>&1 && [[ -f "$PLUGIN_ROOT/bin/devt-tools.cjs" ]]; then
  node "$PLUGIN_ROOT/bin/devt-tools.cjs" state reset
  echo "Workflow state reset (all .devt/state/ files cleaned)"
else
  # Fallback if node unavailable
  STATE_DIR=".devt/state"
  if [[ -d "$STATE_DIR" ]]; then
    find "$STATE_DIR" -maxdepth 1 -type f \( -name "*.md" -o -name "*.yaml" -o -name "*.json" \) -delete 2>/dev/null || true
    echo "Workflow state reset (all .devt/state/ files cleaned)"
  else
    echo "No .devt/state/ directory found"
  fi
fi
