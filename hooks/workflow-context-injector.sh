#!/usr/bin/env bash
[[ $- == *i* ]] && return
# Inject active workflow state into user prompts.
# Reads workflow state via devt-tools.cjs and outputs additionalContext JSON.
# Exit 0 always — non-zero would block the user's prompt.
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Read current workflow state (exit 0 on failure — don't block the prompt)
STATE_JSON=$(node "${PLUGIN_ROOT}/bin/devt-tools.cjs" state read 2>/dev/null) || exit 0

# Parse state and build context using node (proper JSON handling)
RESULT=$(node -e "
  const state = JSON.parse(process.argv[1]);
  if (!state.active) {
    process.exit(0);
  }
  const context = 'Active workflow: type=' + (state.workflow_type || 'none') +
    ', phase=' + (state.phase || 'none') +
    ', tier=' + (state.tier || 'none') +
    ', iteration=' + (state.iteration || 0) +
    ', task=' + (state.task || 'none');
  const output = {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: context
    }
  };
  process.stdout.write(JSON.stringify(output));
" "$STATE_JSON" 2>/dev/null) || exit 0

[ -n "$RESULT" ] && echo "$RESULT"
exit 0
