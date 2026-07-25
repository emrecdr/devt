#!/usr/bin/env bash
[[ $- == *i* ]] && return
# Workflow completion guard on Stop event.
# If a workflow is active and incomplete, warns Claude to finish or pause.
# If workflow is complete or inactive, saves state and allows exit.
#
# One compound CLI call (`state stop-hook`) replaces the prior 8-spawn
# bash/node chain (field-measured p50 928ms per turn end — the Stop event
# fires at EVERY response end in all profiles). All routing — the
# stop_hook_active loop guard, the knowledge-candidate harvest, the curation
# hint, the incomplete-workflow stop stamp, and the stopReason emission —
# lives in state.cjs::stopHook. This wrapper only reads stdin and fails open
# (base stopReason) if the CLI itself cannot run.
set -euo pipefail
source "$(dirname "$0")/_common.sh"

PLUGIN_ROOT="$(devt_plugin_root)"
INPUT="$(devt_read_stdin)"

printf '%s' "$INPUT" | node "${PLUGIN_ROOT}/bin/devt-tools.cjs" state stop-hook 2>/dev/null \
  || printf '%s' '{"stopReason":"Workflow stopped. State preserved in .devt/state/"}'
