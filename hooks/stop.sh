#!/usr/bin/env bash
[[ $- == *i* ]] && return
# Workflow completion guard on Stop event.
# If a workflow is active and incomplete, warns Claude to finish or pause.
# If workflow is complete or inactive, saves state and allows exit.
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Read hook input JSON from stdin (non-blocking)
INPUT=""
if ! [ -t 0 ]; then
  INPUT="$(timeout 3 cat 2>/dev/null || true)"
fi

# Check stop_hook_active from JSON input to prevent infinite loops
if [[ -n "$INPUT" ]]; then
  IS_ACTIVE=$(node -e "
    try {
      const d = JSON.parse(process.argv[1]);
      process.stdout.write(String(d.stop_hook_active || false));
    } catch { process.stdout.write('false'); }
  " "$INPUT" 2>/dev/null) || IS_ACTIVE="false"
  if [[ "$IS_ACTIVE" == "true" ]]; then
    exit 0
  fi
fi

# Read workflow state
STATE_JSON=$(node "${PLUGIN_ROOT}/bin/devt-tools.cjs" state read 2>/dev/null || echo '{}')

# Parse state and extract fields in a single node call
IFS=$'\n' read -r IS_WORKFLOW_ACTIVE IS_COMPLETE PHASE TASK <<< "$(node -e "
  const s = JSON.parse(process.argv[1]);
  const active = s.active === true || s.active === 'true';
  const phase = s.phase || 'unknown';
  const status = s.status || '';
  const task = (s.task || '').replace(/\n/g, ' ');
  const isComplete = ['complete', 'finalize'].includes(phase) || ['DONE', 'BLOCKED'].includes(status);
  [String(active), String(isComplete), phase, task].forEach(v => process.stdout.write(v + '\n'));
" "$STATE_JSON" 2>/dev/null || printf 'false\ntrue\nunknown\n\n')"

# If workflow is active and NOT complete, warn about incomplete workflow
if [[ "$IS_WORKFLOW_ACTIVE" == "true" && "$IS_COMPLETE" == "false" ]]; then
  # Persist stop point for resume (single atomic call to avoid inconsistent intermediate state)
  node "${PLUGIN_ROOT}/bin/devt-tools.cjs" state update "stopped_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)" "stopped_phase=${PHASE}" active=false >/dev/null 2>&1 || true

  CONTEXT="WARNING: Workflow stopped before completion. Phase '${PHASE}' was in progress."
  if [[ -n "$TASK" ]]; then
    CONTEXT="${CONTEXT} Task: ${TASK}."
  fi
  CONTEXT="${CONTEXT} State preserved in .devt/state/. Run /devt:next to resume or /devt:cancel-workflow to reset."

  node -e "
    const ctx = process.argv[1];
    process.stdout.write(JSON.stringify({ stopReason: ctx }));
  " "$CONTEXT"
  exit 0
fi

# Workflow is complete or inactive — clean exit
echo '{"stopReason": "Workflow stopped. State preserved in .devt/state/"}'
