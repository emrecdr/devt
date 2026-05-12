#!/usr/bin/env bash
set -euo pipefail
# Cancel active devt workflow
PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
node "$PLUGIN_ROOT/bin/devt-tools.cjs" state update active=false phase=null tier=null complexity=null iteration=0 task=null verdict=null repair=null status=null workflow_type=null workflow_id=null stopped_phase=null stopped_at=null skipped_phases=null autonomous=null autonomous_chain=null verify_iteration=0 last_session=null resume_context=null decisions_file=null
# Phase 4: clean per-workflow scoped artifacts including the Pre-Flight Brief.
# preflight-brief.md is per-workflow ephemeral — re-running /devt:preflight rebuilds it.
# Scratchpad PREFLIGHT lines also reset so the next workflow starts clean.
rm -f .devt/state/preflight-brief.md .devt/state/scratchpad.md 2>/dev/null || true
echo "Workflow cancelled. State reset to clean slate (preflight-brief.md + scratchpad.md removed)."
