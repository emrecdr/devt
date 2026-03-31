#!/usr/bin/env bash
set -euo pipefail
# Cancel active devt workflow
PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
node "$PLUGIN_ROOT/bin/devt-tools.cjs" state update active=false phase=null tier=null iteration=0 task=null verdict=null repair=null status=null workflow_type=null stopped_phase=null stopped_at=null skipped_phases=null autonomous=null verify_iteration=0
echo "Workflow cancelled. State reset to clean slate."
