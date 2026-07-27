#!/usr/bin/env bash
[[ $- == *i* ]] && return
# Agent lifecycle tracking -- writes running/completed status to .devt/state/status.json.
# Usage: subagent-status.sh start|stop
# Designed for async hooks: fast, no blocking operations.
set -euo pipefail
source "$(dirname "$0")/_common.sh"

ACTION="${1:-}"
if [[ -z "$ACTION" ]]; then
  exit 0
fi

# Read agent info from stdin (hook input JSON)
INPUT="$(devt_read_stdin)"

# Extract and sanitize agent name using node (guaranteed available, proper JSON parsing)
AGENT_NAME="unknown"
if [[ -n "$INPUT" ]]; then
  AGENT_NAME=$(printf '%s' "$INPUT" | node -e "
    const d = JSON.parse(require('fs').readFileSync(0, 'utf8'));
    let name = String(d.agentName || d.name || 'unknown');
    // Sanitize: alphanumeric, hyphens, underscores only; max 64 chars
    name = name.replace(/[^a-zA-Z0-9\-_]/g, '_').slice(0, 64);
    // Guard against prototype pollution keys
    if (['__proto__', 'constructor', 'prototype'].includes(name)) name = '_' + name;
    process.stdout.write(name);
  " 2>/dev/null) || AGENT_NAME="unknown"
fi

STATUS="running"
if [[ "$ACTION" == "stop" ]]; then
  STATUS="completed"
fi

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Append-only event record FIRST — status.json keys by resolved name, so
# same-name (or unresolved-"unknown") agents merge last-writer-wins there;
# the JSONL keeps every event (field: three distinct agents collapsed into
# one status.json record). status.json stays as the derived last-known view.
mkdir -p .devt/state
printf '%s\n' "{\"ts\":\"$(date -u +"%Y-%m-%dT%H:%M:%SZ")\",\"event\":\"${ACTION}\",\"agent\":\"${AGENT_NAME}\"}" >> .devt/state/subagent-events.jsonl 2>/dev/null || true

# New agent activity on a stop-stamped workflow means the stop was a turn
# boundary, not an end — clear the stamp so state reads truthfully during
# resumed work (cheap no-op when no stamp is present).
if [[ "$ACTION" == "start" ]]; then
  node "$(devt_plugin_root)/bin/devt-tools.cjs" state reactivate >/dev/null 2>&1 || true
fi

# Write status — merge into existing status.json to preserve concurrent agent tracking
node -e "
  const fs = require('fs');
  const statusFile = '.devt/state/status.json';
  let agents = {};
  try { agents = JSON.parse(fs.readFileSync(statusFile, 'utf8')); } catch {}
  if (!agents.agents) agents = { agents: {} };
  agents.agents[process.argv[1]] = { status: process.argv[2], timestamp: process.argv[3] };
  const tmp = statusFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(agents, null, 2) + '\n');
  fs.renameSync(tmp, statusFile);
" "$AGENT_NAME" "$STATUS" "$TIMESTAMP"
