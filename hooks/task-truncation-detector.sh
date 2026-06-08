#!/usr/bin/env bash
# Task truncation detector — PostToolUse hook on Task tool calls.
# Records sub-agent return signals to .devt/state/dispatch-warnings.jsonl when
# a cliff condition triggers: near_cliff (output ≥ threshold), low_output
# (output < 500B), or mid_task_language (continuation phrasing in the return).
# The record is tagged with the triggering signal(s) and an additionalContext
# advisory is surfaced to the orchestrator.
#
# Threshold default: 40KB; override via .devt/config.json::telemetry.task_truncation_warn_bytes.
# After greenfield calibration (June 2026) shipped enough field data to confirm
# the cliff sits well above the typical sub-agent return, this hook only writes
# when a cliff triggers — the calibration-mode emit-every-return was 93% noise.
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
  // Claude Code passes tool_name='Agent' for sub-agent dispatches (the Task tool's
  // canonical payload key). Older versions used 'Task'. Accept both — the matcher
  // in hooks.json filters at the platform layer; this is defensive backstop.
  const _toolName = input.tool_name || '';
  if (_toolName !== 'Task' && _toolName !== 'Agent') process.exit(0);

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
  let logAll = false;
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
            // task_truncation_log_all: calibration-mode opt-in. When true,
            // every dispatch return logs to dispatch-warnings.jsonl even
            // when no cliff signal fires — full coverage for telemetry
            // analysis cycles. Default false (quiet-by-default).
            const la = cfg && cfg.telemetry && cfg.telemetry.task_truncation_log_all;
            if (la === true) logAll = true;
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

  // WI-3b (greenfield calibration #17): LOW-output cliff detection. Greenfield's
  // 'Now B.5' case returned 140 bytes from a programmer at the 91-tool wall;
  // the existing 40KB near_cliff didn't fire because the byte count was tiny.
  // A suspiciously SMALL return often signals mid-task truncation just as much
  // as a suspiciously LARGE return signals context overflow. Field evidence:
  // 140 bytes; chosen threshold 500 gives 3.5x headroom over the observed case.
  const LOW_OUTPUT_THRESHOLD = 500;
  const lowOutput = outputBytes < LOW_OUTPUT_THRESHOLD;

  // WI-3b: opportunistic stop_reason capture. Claude API messages carry a
  // stop_reason field (end_turn / max_tokens / tool_use / pause_turn / refusal).
  // If the Claude Code Task tool surfaces it through PostToolUse.tool_response,
  // we capture it as a structured signal. Fail-open: null when absent.
  let stopReason = null;
  if (resp && typeof resp === 'object' && !Array.isArray(resp) && typeof resp.stop_reason === 'string') {
    stopReason = resp.stop_reason;
  }

  // WI-5b / M9 (greenfield calibration #16/#17 H section): mid-task language
  // backup signal. Catches agents that hit a budget wall and returned a short
  // continuation message ('Now B.5', 'continuing with phase 2', 'paused after
  // step 3') instead of emitting Status: PARTIAL explicitly per the Q8 contract.
  // Three patterns kept tight to minimize false positives:
  //   - phase markers: 'Now B.5', 'then C.3', 'Next R2'
  //   - paused-language: 'paused at...', 'paused after...'
  //   - continuation prefixes followed by section names
  // Workflow runners combine this with low_output and Status field to decide
  // whether to advance or SendMessage-resume.
  const midTaskRegex = /\b(now|then|next)\s+[A-Z]\.?\d+(\.\d+)?\b|\bpaused?\s+(at|on|after)\b|\bcontinu(e|ing)\s+(with|from|later)\b/i;
  const midTaskLanguage = midTaskRegex.test(responseText);

  // Quiet-by-default: write a forensic record + emit advisory ONLY when a
  // cliff signal fires. Greenfield field data (June 2026) showed 93% of
  // emit-every-return records carried no actionable signal.
  //
  // Calibration-mode override: when telemetry.task_truncation_log_all=true,
  // skip this short-circuit so every dispatch logs a record (no advisory
  // emit on the no-signal path — that part stays signal-gated below).
  const cliffFired = nearCliff || lowOutput || midTaskLanguage;
  if (!cliffFired && !logAll) process.exit(0);

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
        low_output: lowOutput,
        low_output_threshold: LOW_OUTPUT_THRESHOLD,
        stop_reason: stopReason,
        mid_task_language: midTaskLanguage,
      });
      // stateDir is derived from a process.cwd() walk locating .devt/state — not user input.
      // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
      fs.appendFileSync(path.join(stateDir, 'dispatch-warnings.jsonl'), record + '\n');
    } catch { /* forensic write failure must NEVER affect the hook */ }
  }

  // Advisory only fires on cliff signals — calibration-mode log-all writes
  // forensic records but does NOT add orchestrator-visible advisory noise.
  if (!cliffFired) process.exit(0);

  // Compose advisory based on which cliff triggered. The two cliffs are mutually
  // exclusive by definition (output can't be both > 40KB and < 500 bytes).
  let advisory;
  if (nearCliff) {
    advisory = [
      '[devt task-truncation] Sub-agent ' + subagent + ' returned ' + outputBytes +
        ' bytes (threshold ' + threshold + '). Output is approaching the budget cliff where ',
      'context can be silently truncated by upstream layers. If the next agent in the chain depends on this output, ',
      'consider (a) reading the structured sidecar artifact written by this agent instead of the prose return, ',
      '(b) re-dispatching with a tighter scope, or (c) splitting the work across multiple Task calls.',
    ].join('');
  } else {
    // lowOutput OR midTaskLanguage branch — both signal possible mid-task return
    const signals = [];
    if (lowOutput) signals.push('low output (' + outputBytes + ' bytes, threshold ' + LOW_OUTPUT_THRESHOLD + ')');
    if (midTaskLanguage) signals.push('mid-task language detected in return text');
    advisory = [
      '[devt task-truncation] Sub-agent ' + subagent + ' return looks like mid-task wall hit: ' + signals.join(', ') + '. ',
      stopReason ? 'Claude stop_reason=' + stopReason + '. ' : '',
      'Verify completeness: (a) read the sidecar artifact and check Status field; ',
      '(b) if Status is PARTIAL or sidecar is absent, SendMessage-resume the same agent with <continue_from_section>...</continue_from_section> ',
      'rather than advancing phase=DONE. See docs/AGENT-CONTRACTS.md::Q8 for PARTIAL semantics.',
    ].join('');
  }

  const output = JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: advisory,
    },
  });
  process.stdout.write(output);
  process.exit(0);
" -- "$INPUT"
