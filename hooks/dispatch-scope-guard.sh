#!/usr/bin/env bash
# Dispatch scope guard — PreToolUse hook on Task tool calls.
# Advisory only: warns when a subagent dispatch's prompt or scope_hint exceeds
# thresholds that risk mid-investigation budget exhaustion. Never blocks.
#
# Two signals checked:
#   1. prompt bytes — large prompts inflate cold-start tokens and squeeze the
#      agent's working budget. Default cap 24576 (24KB).
#   2. <scope_hint> path count — if the orchestrator passes too many starting
#      paths, the agent may not finish reading them all before hitting its
#      turn budget. Default cap 8.
#
# Forensic trail: each warning appends one JSONL record to
# .devt/state/dispatch-warnings.jsonl. Same atomic-append guarantee as
# preflight-denies.jsonl (single fs.appendFileSync under PIPE_BUF).
#
# Config keys (read from .devt/config.json::dispatch.*):
#   max_prompt_bytes  (default 24576)
#   max_files_hint    (default 12)
#
[[ $- == *i* ]] && return
set -euo pipefail

INPUT=""
if ! [ -t 0 ]; then
  INPUT="$(timeout 3 cat 2>/dev/null || true)"
fi

if [[ -z "$INPUT" ]]; then
  exit 0
fi

# Inspect, score, and emit hook output in one Node subprocess. Avoids the
# multi-subprocess fanout pattern that bloated earlier hooks. The script
# is intentionally self-contained — config reads degrade silently to
# defaults when .devt/config.json is missing or malformed.
node -e "
  let input;
  try { input = JSON.parse(process.argv[1]); } catch { process.exit(0); }
  // Claude Code passes tool_name='Agent' for sub-agent dispatches (the Task tool's
  // canonical payload key). Older versions used 'Task'. Accept both — the matcher
  // in hooks.json filters at the platform layer; this is defensive backstop.
  const _toolName = input.tool_name || '';
  if (_toolName !== 'Task' && _toolName !== 'Agent') process.exit(0);

  const prompt = (input.tool_input || {}).prompt || '';
  if (!prompt) process.exit(0);

  // Config — local file read with defaults on any failure.
  let maxBytes = 24576;
  let maxFiles = 12;
  try {
    const fs = require('fs');
    const path = require('path');
    let dir = process.cwd();
    for (let i = 0; i < 8; i++) {
      const cfg = path.join(dir, '.devt', 'config.json');
      if (fs.existsSync(cfg)) {
        const c = JSON.parse(fs.readFileSync(cfg, 'utf8'));
        if (c && c.dispatch) {
          if (typeof c.dispatch.max_prompt_bytes === 'number') maxBytes = c.dispatch.max_prompt_bytes;
          if (typeof c.dispatch.max_files_hint === 'number') maxFiles = c.dispatch.max_files_hint;
        }
        break;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch { /* defaults stay */ }

  const promptBytes = Buffer.byteLength(prompt, 'utf8');
  let scopeHintCount = 0;
  const match = prompt.match(/<scope_hint>([\s\S]*?)<\/scope_hint>/);
  if (match) {
    try {
      const arr = JSON.parse(match[1].trim());
      if (Array.isArray(arr)) scopeHintCount = arr.length;
    } catch { /* malformed scope_hint — count stays 0 */ }
  }

  const subagent = (input.tool_input || {}).subagent_type || 'Task';
  const warnings = [];
  if (promptBytes > maxBytes) {
    warnings.push('dispatch prompt is ' + promptBytes + ' B (cap=' + maxBytes + '); risk of mid-investigation budget exhaustion');
  }
  if (scopeHintCount > maxFiles) {
    warnings.push('scope_hint has ' + scopeHintCount + ' paths (cap=' + maxFiles + '); agent may not finish reading all of them');
  }

  if (warnings.length === 0) process.exit(0);

  // Forensic append — best-effort, never fails the hook.
  try {
    const fs = require('fs');
    const path = require('path');
    let dir = process.cwd();
    let stateDir = null;
    for (let i = 0; i < 8; i++) {
      const candidate = path.join(dir, '.devt', 'state');
      if (fs.existsSync(candidate)) { stateDir = candidate; break; }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    if (stateDir) {
      const record = JSON.stringify({
        ts: new Date().toISOString(),
        source: 'dispatch_scope',
        agent: subagent,
        prompt_bytes: promptBytes,
        scope_hint_count: scopeHintCount,
        cap_bytes: maxBytes,
        cap_files: maxFiles,
        warnings,
      }) + '\n';
      fs.appendFileSync(path.join(stateDir, 'dispatch-warnings.jsonl'), record);
    }
  } catch { /* log failure non-fatal */ }

  // Emit advisory context to the orchestrator. Dispatch proceeds either way.
  const ctx = 'DISPATCH-SCOPE [' + subagent + ']: ' + warnings.join('; ') + ' — advisory; dispatch proceeds. Consider tightening the brief if budget exhaustion occurs.';
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: ctx,
    },
  }));
" "$INPUT" 2>/dev/null || true
