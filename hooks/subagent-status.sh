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
    // When none match, report the payload's TOP-LEVEL KEY NAMES (never values —
    // this is a hook payload and may carry paths or prompt text) so the next
    // run diagnoses the gap instead of recording 'unknown' forever. Emitted on
    // STDOUT after a tab, not stderr: this whole substitution is wrapped in
    // 2>/dev/null to keep the hook silent on malformed input, so a stderr
    // diagnostic would be written and immediately discarded.
    let probe = '';
    if (!raw) {
      probe = Object.keys(d || {}).slice(0, 12).join(',');
      raw = 'unknown';
    }
    let name = String(raw);
    // Sanitize: alphanumeric, hyphens, underscores only; max 64 chars
    name = name.replace(/[^a-zA-Z0-9\-_]/g, '_').slice(0, 64);
    // Guard against prototype pollution keys
    if (['__proto__', 'constructor', 'prototype'].includes(name)) name = '_' + name;
    process.stdout.write(name + (probe ? '\t' + probe : ''));
  " 2>/dev/null) || AGENT_NAME="unknown"
  # Split the name from the diagnostic tail.
  PAYLOAD_KEYS="${AGENT_NAME#*$'\t'}"
  [[ "$PAYLOAD_KEYS" == "$AGENT_NAME" ]] && PAYLOAD_KEYS=""
  AGENT_NAME="${AGENT_NAME%%$'\t'*}"
  [[ -z "$AGENT_NAME" ]] && AGENT_NAME="unknown"
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
# Mirror bin/modules/state-io.cjs::getStateDir — every reader resolves through
# it, and it honours DEVT_WORKFLOW_ID. Writing to a bare `.devt/state` put this
# ledger where the readers do not look under multi-instance mode, which
# silently disabled the concurrent-rotation guard in exactly the concurrent
# case it exists for. Resolved in bash rather than by shelling out to the CLI:
# this hook fires on every subagent start/stop (260 times in one field run) and
# a node spawn per event is not worth one path.
DEVT_STATE_DIR=".devt/state"
if [[ -n "${DEVT_WORKFLOW_ID:-}" ]] && [[ "${DEVT_WORKFLOW_ID}" =~ ^[A-Za-z0-9_-]{1,64}$ ]]; then
  DEVT_STATE_DIR=".devt/state/${DEVT_WORKFLOW_ID}"
fi
mkdir -p "$DEVT_STATE_DIR"
if [[ -n "${PAYLOAD_KEYS:-}" ]]; then
  printf '%s\n' "{\"ts\":\"${TIMESTAMP}\",\"event\":\"${ACTION}\",\"agent\":\"${AGENT_NAME}\",\"payload_keys\":\"${PAYLOAD_KEYS}\"}" >> "$DEVT_STATE_DIR/subagent-events.jsonl" 2>/dev/null || true
else
  printf '%s\n' "{\"ts\":\"${TIMESTAMP}\",\"event\":\"${ACTION}\",\"agent\":\"${AGENT_NAME}\"}" >> "$DEVT_STATE_DIR/subagent-events.jsonl" 2>/dev/null || true
fi

# New agent activity on a stop-stamped workflow means the stop was a turn
# boundary, not an end — clear the stamp so state reads truthfully during
# resumed work. Only spawn the reactivate process when a REAL stop stamp is on
# disk: a bare grep beats loading the whole state module graph on every start
# just to no-op. `reactivate` then applies the recency bound. Cleared stamps
# serialize as `stopped_at: null` and never-stopped ones have no key — the
# `"?[0-9]` tail matches only a genuine ISO timestamp.
if [[ "$ACTION" == "start" ]] && grep -qE '^stopped_at: "?[0-9]' "$DEVT_STATE_DIR/workflow.yaml" 2>/dev/null; then
  node "$(devt_plugin_root)/bin/devt-tools.cjs" state reactivate >/dev/null 2>&1 || true
fi

# Write status — merge into existing status.json to preserve concurrent agent tracking
node -e "
  const fs = require('fs');
  const statusFile = process.argv[4] + '/status.json';
  let agents = {};
  try { agents = JSON.parse(fs.readFileSync(statusFile, 'utf8')); } catch {}
  if (!agents.agents) agents = { agents: {} };
  agents.agents[process.argv[1]] = { status: process.argv[2], timestamp: process.argv[3] };
  const tmp = statusFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(agents, null, 2) + '\n');
  fs.renameSync(tmp, statusFile);
" "$AGENT_NAME" "$STATUS" "$TIMESTAMP" "$DEVT_STATE_DIR"
