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
    // Try every key the harness has plausibly used for the agent identity.
    // Field evidence: 260 invocations carrying ~1.8KB payloads all resolved to
    // 'unknown', so per-agent status tracking has never worked here and every
    // consumer keyed on the name silently saw one merged record. The payload
    // shape is harness-owned and can change between versions, hence a list
    // rather than one key.
    const CANDIDATES = ['agentName','name','subagent_type','subagentType','agent_type','agentType','agent'];
    let raw = null;
    for (const k of CANDIDATES) {
      const v = d && d[k];
      if (typeof v === 'string' && v.trim()) { raw = v.trim(); break; }
    }
    // When none match, emit the payload's TOP-LEVEL KEY NAMES (never values —
    // this is a hook payload and may carry paths or prompt text) so the next
    // run diagnoses the gap instead of recording 'unknown' forever.
    if (!raw) {
      const keys = Object.keys(d || {}).slice(0, 12).join(',');
      process.stderr.write('[devt] subagent-status: no agent-name key in payload; top-level keys: ' + keys + '\n');
      raw = 'unknown';
    }
    let name = String(raw);
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
printf '%s\n' "{\"ts\":\"${TIMESTAMP}\",\"event\":\"${ACTION}\",\"agent\":\"${AGENT_NAME}\"}" >> .devt/state/subagent-events.jsonl 2>/dev/null || true

# New agent activity on a stop-stamped workflow means the stop was a turn
# boundary, not an end — clear the stamp so state reads truthfully during
# resumed work. Only spawn the reactivate process when a REAL stop stamp is on
# disk: a bare grep beats loading the whole state module graph on every start
# just to no-op. `reactivate` then applies the recency bound. Cleared stamps
# serialize as `stopped_at: null` and never-stopped ones have no key — the
# `"?[0-9]` tail matches only a genuine ISO timestamp.
if [[ "$ACTION" == "start" ]] && grep -qE '^stopped_at: "?[0-9]' .devt/state/workflow.yaml 2>/dev/null; then
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
