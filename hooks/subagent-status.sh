#!/usr/bin/env bash
[[ $- == *i* ]] && return
# Agent lifecycle tracking -- writes running/completed status to .devt/state/status.json.
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
  INPUT="$(timeout 3 cat 2>/dev/null || true)"
fi

# Extract and sanitize agent name using node (guaranteed available, proper JSON parsing)
AGENT_NAME="unknown"
if [[ -n "$INPUT" ]]; then
  AGENT_NAME=$(node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
    let name = String(d.agentName || d.name || 'unknown');
    // Sanitize: alphanumeric, hyphens, underscores only; max 64 chars
    name = name.replace(/[^a-zA-Z0-9\-_]/g, '_').slice(0, 64);
    // Guard against prototype pollution keys
    if (['__proto__', 'constructor', 'prototype'].includes(name)) name = '_' + name;
    process.stdout.write(name);
  " <<< "$INPUT" 2>/dev/null) || AGENT_NAME="unknown"
fi

STATUS="running"
if [[ "$ACTION" == "stop" ]]; then
  STATUS="completed"
fi

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Write status — merge into existing status.json to preserve concurrent agent tracking
mkdir -p .devt/state
node -e "
  const fs = require('fs');
  const statusFile = '.devt/state/status.json';
  let agents = {};
  try { agents = JSON.parse(fs.readFileSync(statusFile, 'utf8')); } catch {}
  if (!agents.agents) agents = { agents: {} };
  agents.agents[process.argv[1]] = { status: process.argv[2], timestamp: process.argv[3] };
  fs.writeFileSync(statusFile, JSON.stringify(agents, null, 2) + '\n');
" "$AGENT_NAME" "$STATUS" "$TIMESTAMP"
