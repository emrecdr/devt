#!/usr/bin/env bash
# Cancel active devt workflow
PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
node "$PLUGIN_ROOT/bin/devt-tools.cjs" state update active=false
echo "Workflow cancelled (active: false). State preserved for debugging."
