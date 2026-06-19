#!/usr/bin/env bash
# Task truncation detector — PostToolUse hook on Task tool calls.
# Records sub-agent return signals to .devt/state/dispatch-warnings.jsonl when
# a cliff condition triggers: near_cliff (output ≥ threshold), low_output
# (output < 500B), or mid_task_language (continuation phrasing in the return).
# The record is tagged with the triggering signal(s) and an additionalContext
# advisory is surfaced to the orchestrator.
#
# Threshold default: 40KB; override via .devt/config.json::telemetry.task_truncation_warn_bytes.
# After field data confirmed
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

  // LOW-output cliff detection. Field signal:
  // 'Now B.5' case returned 140 bytes from a programmer at the 91-tool wall;
  // the existing 40KB near_cliff didn't fire because the byte count was tiny.
  // A suspiciously SMALL return often signals mid-task truncation just as much
  // as a suspiciously LARGE return signals context overflow. Field evidence:
  // 140 bytes; chosen threshold 500 gives 3.5x headroom over the observed case.
  const LOW_OUTPUT_THRESHOLD = 500;
  // Proportional-response gate. Trivial/experimental dispatches with tiny
  // prompts (e.g. probe → small reply) trip lowOutput and produce false-
  // alarm SendMessage-resume suggestions. Real workflow dispatches carry
  // envelope blocks alone >= ~1KB; below that, small reply is proportional,
  // not a cliff. Gate fires only when the prompt was substantive (>= 1000
  // bytes).
  const PROMPT_SIZE_GATE = 1000;
  const promptText = (input.tool_input || {}).prompt || '';
  const promptBytes = Buffer.byteLength(promptText, 'utf8');
  const lowOutput = outputBytes < LOW_OUTPUT_THRESHOLD && promptBytes >= PROMPT_SIZE_GATE;

  // WI-3b: opportunistic stop_reason capture. Claude API messages carry a
  // stop_reason field (end_turn / max_tokens / tool_use / pause_turn / refusal).
  // If the Claude Code Task tool surfaces it through PostToolUse.tool_response,
  // we capture it as a structured signal. Fail-open: null when absent.
  let stopReason = null;
  if (resp && typeof resp === 'object' && !Array.isArray(resp) && typeof resp.stop_reason === 'string') {
    stopReason = resp.stop_reason;
  }

  // M7 — opportunistic stop_details.category capture (Opus 4.7+). When the
  // model refuses or otherwise halts with a structured category, capture
  // it as a structured signal. Categories observed: policy_violation,
  // unclear_instruction, content_safety, recitation. Surfaces a routing
  // hint to the orchestrator when present + category-specific:
  //   - unclear_instruction -> suggest re-dispatch with clarification
  //   - policy_violation    -> log + do NOT retry (terminal)
  //   - content_safety      -> escalate to user via additionalContext
  const REFUSAL_HINTS = {
    unclear_instruction: '[devt refusal=unclear_instruction] Re-dispatch the agent with an explicit clarification block — the prior prompt was ambiguous to the model. Consider adding concrete examples or sharpening the success criteria.',
    policy_violation: '[devt refusal=policy_violation] Terminal refusal — do NOT retry with the same prompt. The request shape conflicts with model policy; rephrase the task or split into sub-tasks that avoid the policy boundary.',
    content_safety: '[devt refusal=content_safety] Content safety refusal — escalating to user. The task involves content the model declines to produce. Operator decision required: rephrase or abort.',
  };
  let stopCategory = null;
  let refusalHint = null;
  if (resp && typeof resp === 'object' && resp.stop_details && typeof resp.stop_details === 'object') {
    if (typeof resp.stop_details.category === 'string' && resp.stop_details.category.length > 0) {
      stopCategory = resp.stop_details.category;
      refusalHint = REFUSAL_HINTS[stopCategory.toLowerCase()]
        || ('[devt refusal=' + stopCategory + '] Refusal with structured category. Inspect the response payload for category-specific guidance.');
    }
  }

  // Mid-task language
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
  // cliff signal fires. Field data shows the vast majority of
  // emit-every-return records carry no actionable signal.
  //
  // Calibration-mode override: when telemetry.task_truncation_log_all=true,
  // skip this short-circuit so every dispatch logs a record (no advisory
  // emit on the no-signal path — that part stays signal-gated below).
  const cliffFired = nearCliff || lowOutput || midTaskLanguage;

  // Compute raw_dispatch hint BEFORE the cliff-exit so the hook can still
  // emit the hint even when this particular dispatch didn't trip a cliff.
  // UX preference: catch the signal in the act-on-it window (PostToolUse
  // return time). Threshold: any raw_dispatch entry in the last 60 minutes
  // triggers the hint.
  let rawDispatchHint = null;
  if (stateDir) {
    try {
      const fs = require('fs');
      const path = require('path');
      const dispatchPath = path.join(stateDir, 'dispatch-warnings.jsonl');
      if (fs.existsSync(dispatchPath)) {
        const oneHourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
        const content = fs.readFileSync(dispatchPath, 'utf8');
        let recentCount = 0;
        for (const ln of content.split('\n')) {
          if (!ln) continue;
          try {
            const r = JSON.parse(ln);
            if (r.source === 'raw_dispatch' && r.ts && r.ts >= oneHourAgo) recentCount++;
          } catch { /* malformed line — counted via JSONL parse path below */ }
        }
        if (recentCount > 0) {
          rawDispatchHint = '[devt] ' + recentCount + ' raw_dispatch incident(s) in last hour — run: node bin/devt-tools.cjs dispatch warnings --by-agent';
        }
      }
    } catch { /* read failure must not break hook */ }
  }

  if (!cliffFired && !logAll && !rawDispatchHint && !refusalHint) process.exit(0);

  // Forensic append — best-effort, never fails the hook.
  if (stateDir) {
    try {
      const fs = require('fs');
      const path = require('path');
      // Signal discriminator lets downstream consumers (dispatch warnings
      // CLI, telemetry filters) filter noise-floor events at READ time
      // without breaking the stuck-detector (state.cjs:3000) which still
      // needs every event in the stream. Field signal: ~246-of-254 cliff
      // records were unactionable noise (signal=healthy) — counting them
      // all produces cry-wolf training operators to ignore the channel.
      // 'healthy' = neither cliff fired and no mid-task language match.
      // Note: avoid backticks in this hook — they trigger bash command
      // substitution inside the surrounding double-quoted heredoc.
      let signal = 'healthy';
      if (lowOutput) signal = 'low_output';
      else if (nearCliff) signal = 'near_cliff';
      else if (midTaskLanguage) signal = 'mid_task';
      const record = JSON.stringify({
        ts: new Date().toISOString(),
        source: 'task_output_bytes',
        signal,
        agent: subagent,
        output_bytes: outputBytes,
        threshold_bytes: threshold,
        near_cliff: nearCliff,
        low_output: lowOutput,
        low_output_threshold: LOW_OUTPUT_THRESHOLD,
        stop_reason: stopReason,
        stop_category: stopCategory,
        refusal_routed: refusalHint ? true : false,
        mid_task_language: midTaskLanguage,
      });
      // stateDir is derived from a process.cwd() walk locating .devt/state — not user input.
      // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
      fs.appendFileSync(path.join(stateDir, 'dispatch-warnings.jsonl'), record + '\n');
    } catch { /* forensic write failure must NEVER affect the hook */ }
  }


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
  } else if (cliffFired) {
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
  } else {
    // No cliff but raw_dispatch hint earned the path here — advisory IS the hint
    advisory = '';
  }

  // A2b: append the raw_dispatch hint to whichever advisory composed above
  // (or stand alone as the entire advisory when no cliff fired).
  if (rawDispatchHint) {
    advisory = advisory ? advisory + '\n\n' + rawDispatchHint : rawDispatchHint;
  }

  // M7: refusal routing — append/replace advisory with category-specific
  // refusal guidance. Refusals are always actionable signal — surfaces first
  // so the operator sees it regardless of other cliffs that fired.
  if (refusalHint) {
    advisory = advisory ? refusalHint + '\n\n' + advisory : refusalHint;
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
