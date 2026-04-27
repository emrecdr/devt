#!/usr/bin/env bash
# Context monitor — lightweight tool call counter
# Warns agents after many tool calls (proxy for context usage)
[[ $- == *i* ]] && return
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Counter keyed by Claude Code's PID (PPID from this hook's perspective) so it persists
# across hook invocations within a session. Use XDG_RUNTIME_DIR (user-private) or TMPDIR.
_DEVT_COUNTER_DIR="${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}"
COUNTER_FILE="${_DEVT_COUNTER_DIR}/devt-tool-count-${PPID}"
# No trap — file persists for the session. Claude Code's process exit cleans up via OS.

# Read and increment counter
COUNT=0
if [[ -f "$COUNTER_FILE" ]]; then
  COUNT=$(cat "$COUNTER_FILE" 2>/dev/null || echo 0)
fi
COUNT=$((COUNT + 1))
echo "$COUNT" > "$COUNTER_FILE"

# Warning thresholds (tool calls, not context %)
WARNING_THRESHOLD=100
CRITICAL_THRESHOLD=150

if [[ $COUNT -ge $CRITICAL_THRESHOLD ]]; then
  CONTEXT="CRITICAL: ${COUNT} tool calls in this session. Context window is likely very full. Wrap up current work, commit progress, and consider starting a fresh session."
elif [[ $COUNT -ge $WARNING_THRESHOLD ]]; then
  CONTEXT="WARNING: ${COUNT} tool calls in this session. Context is getting large. Consider completing the current task soon."
else
  exit 0  # No warning needed — exit 0 to avoid blocking the tool call
fi

# Output warning as additionalContext
node -e "
  const ctx = process.argv[1];
  const output = {
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: ctx
    }
  };
  process.stdout.write(JSON.stringify(output));
" "$CONTEXT"
