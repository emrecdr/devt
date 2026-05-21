#!/usr/bin/env bash
# Dispatch hygiene guard — PreToolUse hook on Task tool calls.
# Advisory only: detects "raw dispatches" where the orchestrator dispatches a
# devt:* subagent WITHOUT the workflow-managed context blocks (<scope_trust>,
# <scope_hint>, <memory_signal>). Closes the failure mode where the orchestrator
# rolls its own Task() fan-out and bypasses /devt:review entirely — all of
# the Wave 1-4 protections (Graphify-first directive, impact-plan, telemetry)
# live inside workflow dispatch templates, so a raw dispatch silently strips
# every integration the workflow was supposed to inject.
#
# Never blocks. Emits an advisory additionalContext block surfaced to the
# orchestrator and appends one JSONL record to .devt/state/dispatch-warnings.jsonl
# tagged source: "raw_dispatch" for /devt:forensics post-hoc analysis.
#
# Trigger condition: subagent_type matches /^devt:/ AND the prompt is MISSING
# all of <scope_trust>, <scope_hint>, and <memory_signal> blocks. Having any
# ONE counts as "workflow-dispatched" — the heuristic is forgiving so workflows
# can update the canonical set over time without retripping this hook.
#
# Kill switch: DEVT_DISABLED_HOOKS=dispatch-hygiene-guard.sh.
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

node -e "
  let input;
  try { input = JSON.parse(process.argv[1]); } catch { process.exit(0); }
  // Claude Code passes tool_name='Agent' for sub-agent dispatches (the Task tool's
  // canonical payload key). Older versions used 'Task'. Accept both — the matcher
  // in hooks.json filters at the platform layer; this is defensive backstop.
  const _toolName = input.tool_name || '';
  if (_toolName !== 'Task' && _toolName !== 'Agent') process.exit(0);

  const subagent = (input.tool_input || {}).subagent_type || '';
  // Only fire on devt:* subagent dispatches. Other agent types are out of scope.
  if (!subagent.startsWith('devt:')) process.exit(0);

  const prompt = (input.tool_input || {}).prompt || '';
  if (!prompt) process.exit(0);

  // Workflow-dispatched prompts always carry at least one of these blocks.
  // Raw orchestrator-rolled prompts carry none. The check is intentionally
  // forgiving: ANY of the three counts as 'workflow-managed'.
  const hasScope = /<scope_trust>/.test(prompt);
  const hasHint = /<scope_hint>/.test(prompt);
  const hasMemSig = /<memory_signal>/.test(prompt);
  if (hasScope || hasHint || hasMemSig) process.exit(0);

  // Raw dispatch detected. Build advisory + forensic record.
  const advisory = [
    'Raw devt:' + subagent.split(':')[1] + ' dispatch detected (no <scope_trust>/<scope_hint>/<memory_signal> blocks in prompt).',
    'This bypasses the workflow contract — Wave 1-4 protections (Graphify-first directive, impact-plan, caller_verification, telemetry surface) only fire when agents are dispatched VIA a devt workflow (/devt:review, /devt:workflow, /devt:debug).',
    'If this is intentional ad-hoc orchestration, the agent will fall back to default behavior (grep-first discovery, no caller-set verification, no telemetry). Consider running /devt:review or /devt:workflow instead.',
  ].join(' ');

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
      const promptPreview = prompt.slice(0, 200).replace(/\n+/g, ' ');
      const record = JSON.stringify({
        ts: new Date().toISOString(),
        source: 'raw_dispatch',
        agent: subagent,
        prompt_bytes: Buffer.byteLength(prompt, 'utf8'),
        prompt_preview: promptPreview,
      });
      fs.appendFileSync(path.join(stateDir, 'dispatch-warnings.jsonl'), record + '\n');
    }
  } catch { /* forensic write failure must NEVER affect the hook */ }

  // PreToolUse advisory — non-blocking. additionalContext surfaces to the LLM.
  const output = JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: '[devt dispatch hygiene] ' + advisory,
    },
  });
  process.stdout.write(output);
  process.exit(0);
" -- "$INPUT"
