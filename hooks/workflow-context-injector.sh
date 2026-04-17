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

  // Active workflow — compact status line
  if (state.active) {
    const tier = state.tier || '?';
    const phase = state.phase || '?';
    const iter = state.iteration || 0;
    const task = state.task ? (state.task.length > 60 ? state.task.slice(0, 57) + '...' : state.task) : 'none';
    const flags = [];
    if (state.autonomous) flags.push('autonomous');
    if (state.tdd_mode) flags.push('tdd');
    if (state.stop_at_phase) flags.push('--to ' + state.stop_at_phase);
    if (state.only_phase) flags.push('--only ' + state.only_phase);
    const flagStr = flags.length > 0 ? ' [' + flags.join(', ') + ']' : '';
    const context = '[devt] ' + tier + ' · ' + phase + (iter > 1 ? ' (iter ' + iter + ')' : '') + flagStr + ' · \"' + task + '\"';
    const output = {
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: context
      }
    };
    process.stdout.write(JSON.stringify(output));
  }
  // Idle — show last known state if available
  else if (state.phase && state.phase !== 'null') {
    const tier = state.tier || '';
    const task = state.task ? (state.task.length > 50 ? state.task.slice(0, 47) + '...' : state.task) : '';
    const context = '[devt] idle · last: ' + (tier ? tier + ' · ' : '') + state.phase + (task ? ' · \"' + task + '\"' : '');
    const output = {
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: context
      }
    };
    process.stdout.write(JSON.stringify(output));
  }
  // No workflow state at all — silent (don't inject noise)
" "$STATE_JSON" 2>/dev/null) || exit 0

# printf avoids echo's flag interpretation (-n, -e) regardless of JSON content
[ -n "$RESULT" ] && printf '%s\n' "$RESULT"
exit 0
