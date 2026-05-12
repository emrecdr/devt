#!/usr/bin/env bash
[[ $- == *i* ]] && return
# Inject active workflow state into user prompts.
# Reads workflow state via devt-tools.cjs and outputs additionalContext JSON.
# Exit 0 always — non-zero would block the user's prompt.
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# State-read cache keyed by workflow.yaml mtime. Hook fires on every
# user prompt; the prior unconditional `node devt-tools.cjs state read` paid
# ~30-60ms cold-start per prompt. Cache invalidates automatically because
# state.cjs::updateState rewrites workflow.yaml on every state change, and we
# pin the cache file's mtime to match.
WF_PATH="$(pwd)/.devt/state/workflow.yaml"
CACHE_DIR="${TMPDIR:-/tmp}/devt-cache"
# 12-char project hash — shasum is universal (macOS + Linux).
PROJ_HASH=$(printf '%s' "$(pwd)" | shasum 2>/dev/null | cut -c1-12)
CACHE_FILE="$CACHE_DIR/wf-state-$PROJ_HASH.json"
STATE_JSON=""

if [ -f "$WF_PATH" ] && [ -f "$CACHE_FILE" ]; then
  # stat -f for BSD/macOS, stat -c for GNU/Linux — try both.
  WF_MTIME=$(stat -f %m "$WF_PATH" 2>/dev/null || stat -c %Y "$WF_PATH" 2>/dev/null || echo 0)
  CACHE_MTIME=$(stat -f %m "$CACHE_FILE" 2>/dev/null || stat -c %Y "$CACHE_FILE" 2>/dev/null || echo 0)
  if [ "$WF_MTIME" != "0" ] && [ "$CACHE_MTIME" != "0" ] && [ "$CACHE_MTIME" -ge "$WF_MTIME" ]; then
    STATE_JSON=$(cat "$CACHE_FILE" 2>/dev/null || true)
  fi
fi

if [ -z "$STATE_JSON" ]; then
  STATE_JSON=$(node "${PLUGIN_ROOT}/bin/devt-tools.cjs" state read 2>/dev/null) || exit 0
  # Populate cache for the next prompt. Pin cache mtime to workflow.yaml mtime
  # so the next mtime comparison reuses without staleness.
  if [ -n "$STATE_JSON" ]; then
    mkdir -p "$CACHE_DIR" 2>/dev/null || true
    printf '%s' "$STATE_JSON" > "$CACHE_FILE" 2>/dev/null || true
    [ -f "$WF_PATH" ] && touch -r "$WF_PATH" "$CACHE_FILE" 2>/dev/null || true
  fi
fi

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
