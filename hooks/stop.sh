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

# Unconditional knowledge-candidate harvest at every workflow exit.
# Field-observed: aggregate-knowledge-candidates is only wired into the
# present_findings step inline — orchestrators that bypass that step
# (raw-dispatched workflows, off-script execution paths) never trigger
# it, so scratchpad.md candidates never propagate to the curator.
# Stop-hook firing guarantees harvest regardless of which exit path the
# workflow took. Fire-and-forget: the aggregator early-returns on absent
# sources, never overwrites existing scratchpad entries, never blocks
# shutdown.
node "${PLUGIN_ROOT}/bin/devt-tools.cjs" state aggregate-knowledge-candidates >/dev/null 2>&1 || true

# Session-end curation surface. Curation triggers are otherwise
# workflow-finalize-bound, so raw-dispatch maintainer sessions (which never
# hit a finalize step) accumulate candidates nobody sees. --hint-only is
# silent unless count>=threshold AND the cooldown window allows, so despite
# Stop firing on every response turn this adds at most one line per cooldown
# window — and session end is also the moment a human would notice an
# anomalous candidate.
CURATION_HINT=$(node "${PLUGIN_ROOT}/bin/devt-tools.cjs" memory candidates-footer --hint-only 2>/dev/null || true)

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
  CONTEXT="${CONTEXT} State preserved in .devt/state/. Run /devt:next to resume or /devt:workflow --cancel to reset."
  if [[ -n "$CURATION_HINT" ]]; then
    CONTEXT="${CONTEXT} ${CURATION_HINT}"
  fi

  node -e "
    const ctx = process.argv[1];
    process.stdout.write(JSON.stringify({ stopReason: ctx }));
  " "$CONTEXT"
  exit 0
fi

# Workflow is complete or inactive — clean exit
node -e "
  const hint = (process.argv[1] || '').trim();
  const base = 'Workflow stopped. State preserved in .devt/state/';
  process.stdout.write(JSON.stringify({ stopReason: hint ? base + ' | ' + hint : base }));
" "$CURATION_HINT"
