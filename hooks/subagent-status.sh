#!/usr/bin/env bash
# Agent lifecycle tracking -- writes running/completed status to .devt-state/status.json.
# Usage: subagent-status.sh start|stop
# Designed for async hooks: fast, no blocking operations.
set -euo pipefail

ACTION="${1:-}"
if [[ -z "$ACTION" ]]; then
  exit 0
fi

# Read agent info from stdin (hook input JSON)
INPUT=""
if ! [ -t 0 ]; then
  INPUT="$(cat)"
fi

# Extract agent name using node (guaranteed available, proper JSON parsing)
AGENT_NAME="unknown"
if [[ -n "$INPUT" ]]; then
  AGENT_NAME=$(node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
    process.stdout.write(d.agentName || d.name || 'unknown');
  " <<< "$INPUT" 2>/dev/null) || AGENT_NAME="unknown"
fi

STATUS="running"
if [[ "$ACTION" == "stop" ]]; then
  STATUS="completed"
fi

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Write status with proper JSON escaping via node
mkdir -p .devt-state
node -e "
  const data = { agent: process.argv[1], status: process.argv[2], timestamp: process.argv[3] };
  require('fs').writeFileSync('.devt-state/status.json', JSON.stringify(data) + '\n');
" "$AGENT_NAME" "$STATUS" "$TIMESTAMP"
