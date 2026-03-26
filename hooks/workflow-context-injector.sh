#!/usr/bin/env bash
# Inject active workflow state into user prompts.
# Reads workflow state via devt-tools.cjs and outputs additionalContext JSON.
# Exit code 2 = skip (no active workflow).
set -uo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Read current workflow state
STATE_JSON=$(node "${PLUGIN_ROOT}/bin/devt-tools.cjs" state read 2>/dev/null) || exit 2

# Parse state and build context using node (proper JSON handling)
RESULT=$(node -e "
  const state = JSON.parse(process.argv[1]);
  if (!state.active) {
    process.exit(2);
  }
  const context = 'Active workflow: phase=' + (state.phase || 'none') +
    ', tier=' + (state.tier || 'none') +
    ', iteration=' + (state.iteration || 0) +
    ', task=' + (state.task || 'none');
  const output = {
    hookSpecificOutput: { additionalContext: context },
    hookEventName: 'UserPromptSubmit'
  };
  process.stdout.write(JSON.stringify(output));
" "$STATE_JSON" 2>/dev/null)

EXIT_CODE=$?
if [[ $EXIT_CODE -eq 2 ]]; then
  exit 2
fi

echo "$RESULT"
