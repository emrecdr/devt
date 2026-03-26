#!/usr/bin/env bash
# Scaffold .dev-rules/ from a template
PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATE="${1:-blank}"
node "$PLUGIN_ROOT/bin/devt-tools.cjs" setup --template "$TEMPLATE"
