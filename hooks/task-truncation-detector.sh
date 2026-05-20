#!/usr/bin/env bash
# Task truncation detector — PostToolUse hook on Task tool calls.
# Records the byte count of every sub-agent return into
# .devt/state/dispatch-warnings.jsonl with source: "task_output_bytes".
# When the byte count crosses telemetry.task_truncation_warn_bytes the record
# is tagged near_cliff:true and an additionalContext advisory is surfaced to
# the orchestrator.
#
# Threshold is a placeholder until field data lands — emitting on EVERY Task
# call (not only crossings) keeps the calibration loop open: the post-hoc
# histogram across observed dispatches is what tells us where the true cliff
# sits. Override via .devt/config.json::telemetry.task_truncation_warn_bytes.
#
# Never blocks. All forensic writes are best-effort and silenced on failure.
# Kill switch: DEVT_DISABLED_HOOKS=task-truncation-detector.sh.
[[ $- == *i* ]] && return
set -euo pipefail

INPUT=""
if ! [ -t 0 ]; then
  INPUT="$(timeout 3 cat 2>/dev/null || true)"
fi

if [[ -z "$INPUT" ]]; then
  exit 0
fi

node -e "
  let input;
  try { input = JSON.parse(process.argv[1]); } catch { process.exit(0); }
  if ((input.tool_name || '') !== 'Task') process.exit(0);

  const subagent = (input.tool_input || {}).subagent_type || 'unknown';

  // tool_response shape varies (string | object | array of content blocks).
  // Normalize to a single string and measure UTF-8 bytes.
  const resp = input.tool_response;
  let responseText = '';
  if (typeof resp === 'string') {
    responseText = resp;
  } else if (resp && typeof resp === 'object') {
    if (Array.isArray(resp.content)) {
      responseText = resp.content
        .map(b => (b && typeof b.text === 'string') ? b.text : '')
        .join('');
    } else if (typeof resp.text === 'string') {
      responseText = resp.text;
    } else {
      try { responseText = JSON.stringify(resp); } catch { responseText = ''; }
    }
  }
  const outputBytes = Buffer.byteLength(responseText, 'utf8');

  // Resolve threshold: config override beats default. Walk up to find .devt/.
  let threshold = 40000;
  let stateDir = null;
  try {
    const fs = require('fs');
    const path = require('path');
    let dir = process.cwd();
    for (let i = 0; i < 8; i++) {
      const candidate = path.join(dir, '.devt');
      if (fs.existsSync(candidate)) {
        const sd = path.join(candidate, 'state');
        if (fs.existsSync(sd)) stateDir = sd;
        const cfgPath = path.join(candidate, 'config.json');
        if (fs.existsSync(cfgPath)) {
          try {
            const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
            const v = cfg && cfg.telemetry && cfg.telemetry.task_truncation_warn_bytes;
            if (Number.isFinite(v) && v > 0) threshold = v;
          } catch { /* malformed config — keep default */ }
        }
        break;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch { /* fs walk failure — keep defaults */ }

  const nearCliff = outputBytes >= threshold;

  // Forensic append — best-effort, never fails the hook.
  if (stateDir) {
    try {
      const fs = require('fs');
      const path = require('path');
      const record = JSON.stringify({
        ts: new Date().toISOString(),
        source: 'task_output_bytes',
        agent: subagent,
        output_bytes: outputBytes,
        threshold_bytes: threshold,
        near_cliff: nearCliff,
      });
      // stateDir is derived from a process.cwd() walk locating .devt/state — not user input.
      // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
      fs.appendFileSync(path.join(stateDir, 'dispatch-warnings.jsonl'), record + '\n');
    } catch { /* forensic write failure must NEVER affect the hook */ }
  }

  if (!nearCliff) process.exit(0);

  // Near-cliff path — surface an advisory. PostToolUse additionalContext is
  // visible to the orchestrator on the next turn.
  const advisory = [
    '[devt task-truncation] Sub-agent ' + subagent + ' returned ' + outputBytes +
      ' bytes (threshold ' + threshold + '). Output is approaching the budget cliff where ',
    'context can be silently truncated by upstream layers. If the next agent in the chain depends on this output, ',
    'consider (a) reading the structured sidecar artifact written by this agent instead of the prose return, ',
    '(b) re-dispatching with a tighter scope, or (c) splitting the work across multiple Task calls.',
  ].join('');

  const output = JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: advisory,
    },
  });
  process.stdout.write(output);
  process.exit(0);
" -- "$INPUT"
