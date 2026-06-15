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
  const fs = require('fs');
  const path = require('path');
  const { execSync } = require('child_process');

  // Active workflow — compact status line.
  // Format is human-facing only (no programmatic consumers). Compactness wins
  // tokens on every UserPromptSubmit during an active workflow.
  if (state.active) {
    const tier = state.tier || '?';
    const phase = state.phase || '?';
    const iter = state.iteration || 0;
    const task = state.task ? (state.task.length > 50 ? state.task.slice(0, 47) + '...' : state.task) : 'none';
    const flags = [];
    if (state.autonomous) flags.push('auto');
    if (state.tdd_mode) flags.push('tdd');
    if (state.stop_at_phase) flags.push('to=' + state.stop_at_phase);
    if (state.only_phase) flags.push('only=' + state.only_phase);
    const flagStr = flags.length > 0 ? '·' + flags.join('+') : '';
    const lines = ['[devt] ' + tier + '/' + phase + (iter > 1 ? '·i' + iter : '') + flagStr + ' · \"' + task + '\"'];

    // G1 (cal #21 round 5 V6): session-scoped telemetry push. Greenfield's
    // V6 honest answer revealed A2/A2b/A4 infrastructure works but discovery
    // surfaces are too passive for an LLM operator — operators forget the
    // CLIs exist when head-down in a workflow. UserPromptSubmit injection
    // surfaces the same signals without requiring the operator to ask.
    // All probes fail-open: any error path → no signal line, no broken hook.
    const workflowStart = state.first_created_at || state.created_at || null;
    if (workflowStart) {
      const startMs = new Date(workflowStart).getTime();
      const signals = [];

      // Probe 1: dispatch-warnings.jsonl session-scoped counts.
      // Inline JSONL scan — same pattern as A2b in task-truncation-detector.sh.
      try {
        const dispatchPath = path.join(process.cwd(), '.devt', 'state', 'dispatch-warnings.jsonl');
        if (fs.existsSync(dispatchPath)) {
          const content = fs.readFileSync(dispatchPath, 'utf8');
          let raw = 0, cliff = 0;
          for (const ln of content.split('\n')) {
            if (!ln) continue;
            try {
              const r = JSON.parse(ln);
              if (!r.ts || new Date(r.ts).getTime() < startMs) continue;
              if (r.source === 'raw_dispatch') raw++;
              else if (r.source === 'task_output_bytes') cliff++;
            } catch { /* malformed line */ }
          }
          if (raw > 0 || cliff > 0) {
            signals.push(raw + ' raw_dispatch + ' + cliff + ' cliff signal(s)');
          }
        }
      } catch { /* fs error — silent */ }

      // Probe 2: inherited source edits via git status, scoped to mtime >
      // workflow start. 1-second timeout caps hook latency cost.
      try {
        const porcelain = execSync('git status --porcelain', {
          cwd: process.cwd(),
          timeout: 1000,
          encoding: 'utf8',
        });
        let inherited = 0;
        for (const ln of porcelain.split('\n')) {
          if (!ln) continue;
          const status = ln.slice(0, 2);
          const filename = ln.slice(3).trim();
          if (status === '??' || status === '!!') continue;
          try {
            const stat = fs.statSync(path.join(process.cwd(), filename));
            if (stat.mtimeMs > startMs) inherited++;
          } catch { /* deleted file or stat error */ }
        }
        if (inherited > 0) {
          signals.push(inherited + ' uncommitted source edit(s) since workflow start');
        }
      } catch { /* git error — silent */ }

      if (signals.length > 0) {
        lines.push('[devt session signal] ' + signals.join('; ') + ' — inspect: dispatch warnings --by-source | state check-inherited-edits');
      }
    }

    const output = {
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: lines.join('\n')
      }
    };
    process.stdout.write(JSON.stringify(output));
  }
  // No active workflow — silent. Idle state is reachable via explicit
  // /devt:status or /devt:next; pinning it into every prompt costs tokens
  // long after the workflow ended without adding load-bearing context.
" "$STATE_JSON" 2>/dev/null) || exit 0

# printf avoids echo's flag interpretation (-n, -e) regardless of JSON content
[ -n "$RESULT" ] && printf '%s\n' "$RESULT"
exit 0
