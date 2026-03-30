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

# Parse state fields
WORKFLOW_STATE=$(node -e "
  const s = JSON.parse(process.argv[1]);
  const active = s.active === true || s.active === 'true';
  const phase = s.phase || 'unknown';
  const tier = s.tier || 'unknown';
  const status = s.status || '';
  const task = s.task || '';
  const iteration = s.iteration || 0;

  // Determine if workflow is complete
  const completePhases = ['complete', 'finalize'];
  const terminalStatuses = ['DONE', 'BLOCKED'];
  const isComplete = completePhases.includes(phase) || terminalStatuses.includes(status);

  process.stdout.write(JSON.stringify({
    active: active,
    phase: phase,
    tier: tier,
    task: task,
    iteration: iteration,
    isComplete: isComplete
  }));
" "$STATE_JSON" 2>/dev/null || echo '{"active":false,"isComplete":true}')

IS_WORKFLOW_ACTIVE=$(node -e "const s=JSON.parse(process.argv[1]); process.stdout.write(String(s.active))" "$WORKFLOW_STATE" 2>/dev/null || echo "false")
IS_COMPLETE=$(node -e "const s=JSON.parse(process.argv[1]); process.stdout.write(String(s.isComplete))" "$WORKFLOW_STATE" 2>/dev/null || echo "true")
PHASE=$(node -e "const s=JSON.parse(process.argv[1]); process.stdout.write(s.phase)" "$WORKFLOW_STATE" 2>/dev/null || echo "unknown")
TASK=$(node -e "const s=JSON.parse(process.argv[1]); process.stdout.write(s.task)" "$WORKFLOW_STATE" 2>/dev/null || echo "")

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
if [[ "$IS_WORKFLOW_ACTIVE" == "true" ]]; then
  node "${PLUGIN_ROOT}/bin/devt-tools.cjs" state update "stopped_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)" "stopped_phase=${PHASE}" active=false >/dev/null 2>&1 || true
fi

echo '{"stopReason": "Workflow stopped. State preserved in .devt/state/"}'
