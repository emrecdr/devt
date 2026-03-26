#!/usr/bin/env bash
# Workflow cleanup on Stop event.
# Reads hook input from stdin, deactivates workflow state, preserves files for debugging.
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Read hook input JSON from stdin (non-blocking)
INPUT=""
if ! [ -t 0 ]; then
  INPUT="$(cat)"
fi

# Check stop_hook_active from JSON input to prevent infinite loops
if [[ -n "$INPUT" ]]; then
  IS_ACTIVE=$(node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); process.stdout.write(String(d.stop_hook_active || false))" <<< "$INPUT")
  if [[ "$IS_ACTIVE" == "true" ]]; then
    exit 0
  fi
fi

# Persist what was happening when stopped
PHASE=$(node -e "
  const fs = require('fs');
  const yaml = require('yaml') || null;
  try {
    const content = fs.readFileSync('${PLUGIN_ROOT}/state/workflow.yaml', 'utf8');
    const match = content.match(/^phase:\s*(.+)$/m);
    process.stdout.write((match && match[1] !== 'null') ? match[1].trim() : 'unknown');
  } catch(e) { process.stdout.write('unknown'); }
" 2>/dev/null || echo "unknown")
node "${PLUGIN_ROOT}/bin/devt-tools.cjs" state update "stopped_at=$(date -u +%Y-%m-%dT%H:%M:%SZ) during ${PHASE}" >/dev/null 2>&1 || true

# Deactivate workflow state
node "${PLUGIN_ROOT}/bin/devt-tools.cjs" state update active=false >/dev/null 2>&1 || true

# Signal to Claude Code that workflow stopped
echo '{"hookSpecificOutput": {"additionalContext": "Workflow stopped. State preserved in .devt-state/"}, "hookEventName": "Stop"}'
