#!/usr/bin/env bash
# Dispatch hygiene guard — PreToolUse hook on Task tool calls.
# Detects "raw dispatches" where the orchestrator dispatches a devt:* subagent
# WITHOUT the workflow-managed context blocks (<scope_trust>, <scope_hint>,
# <memory_signal>). Closes the failure mode where the orchestrator rolls its
# own Task() fan-out and bypasses /devt:review entirely — all of the Wave 1-4
# protections (Graphify-first directive, impact-plan, telemetry) live inside
# workflow dispatch templates, so a raw dispatch silently strips every
# integration the workflow was supposed to inject.
#
# L1 — Behavior depends on `dispatch_hygiene_mode` in .devt/config.json:
#   block (default) — hook returns {decision:"deny"} for investigative subagents
#     (code-reviewer, programmer, verifier, researcher, debugger, architect,
#     tester). Hard-blocks the dispatch. Curator/docs-writer/retro are exempt
#     because they don't consume scope blocks.
#   warn — hook returns additionalContext advisory; allows the call.
#   off — hook is a no-op for raw dispatches.
# Always appends a forensic JSONL record to .devt/state/dispatch-warnings.jsonl
# regardless of mode, so /devt:debug --mode=forensics can analyze bypass attempts.
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
  // forgiving: ANY of the signals counts as workflow-managed.
  //
  // Content-aware expansion (greenfield audit, post-v0.90 trajectory):
  // legitimate hand-injected envelopes (iter-2 revision dispatches,
  // custom lane fan-out with structured context blocks) were being flagged
  // as raw_dispatch because they use richer structures than the canonical
  // scope_*/memory_signal trio. Expanded the signal set to include any
  // of: context, graph_impact, original_review, lane_scope,
  // god_node_warnings, prior_outputs, provenance_protocol. ANY one of
  // these (in addition to the original canonical three) indicates an
  // envelope-managed dispatch — content-aware detection that closes the
  // hand-injected-envelope false-positive class.
  const hasScope = /<scope_trust>/.test(prompt);
  const hasHint = /<scope_hint>/.test(prompt);
  const hasMemSig = /<memory_signal>/.test(prompt);
  const hasContext = /<context>/.test(prompt);
  const hasGraphImpact = /<graph_impact>/.test(prompt);
  const hasOriginalReview = /<original_review>/.test(prompt);
  const hasLaneScope = /<lane_scope>/.test(prompt);
  const hasGodNode = /<god_node_warnings>/.test(prompt);
  const hasPriorOutputs = /<prior_outputs>/.test(prompt);
  const hasProvenance = /<provenance_protocol>/.test(prompt);
  if (hasScope || hasHint || hasMemSig || hasContext || hasGraphImpact ||
      hasOriginalReview || hasLaneScope || hasGodNode || hasPriorOutputs ||
      hasProvenance) process.exit(0);

  // Envelope-not-required agents — per agents/io-contracts.yaml, these agents
  // declare graphify_inputs: [] AND don't consume memory_signal/scope blocks.
  // Their dispatches LEGITIMATELY lack the envelope; the hook would over-fire
  // and pollute dispatch-warnings.jsonl with false-positive raw_dispatch
  // records (greenfield 2026-06-02 evidence: 2 of 11 raw_dispatch records
  // were docs-writer + retro, both contracted to receive no envelope).
  // devt-coordinator is a main-thread router with no envelope contract.
  const subagentName = subagent.slice(5);  // strip 'devt:' prefix
  const ENVELOPE_NOT_REQUIRED = new Set(['docs-writer', 'retro', 'curator', 'devt-coordinator']);
  if (ENVELOPE_NOT_REQUIRED.has(subagentName)) process.exit(0);

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

  // L1 — read dispatch_hygiene_mode from project's .devt/config.json (upward
  // search). Defaults to 'block'. Failure to read = block (fail-secure: better
  // to over-block a misconfigured project than to silently strip the gate).
  let mode = 'block';
  try {
    const fs = require('fs');
    const path = require('path');
    let dir = process.cwd();
    for (let i = 0; i < 8; i++) {
      const candidate = path.join(dir, '.devt', 'config.json');
      if (fs.existsSync(candidate)) {
        const cfg = JSON.parse(fs.readFileSync(candidate, 'utf8'));
        if (cfg && typeof cfg.dispatch_hygiene_mode === 'string') {
          mode = cfg.dispatch_hygiene_mode.toLowerCase();
        }
        break;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch { /* keep default 'block' on any failure */ }

  if (mode === 'off') process.exit(0);

  // Agent-type filter for block mode. Only investigative agents consume scope
  // blocks; curator/docs-writer/retro/devt-coordinator dispatch templates
  // legitimately don't have <scope_trust>/<scope_hint>/<memory_signal> blocks.
  // Blocking them would over-fire. Warn mode still surfaces the advisory.
  const INVESTIGATIVE = new Set([
    'code-reviewer', 'programmer', 'verifier', 'researcher',
    'debugger', 'architect', 'tester',
  ]);
  const shouldBlock = mode === 'block' && INVESTIGATIVE.has(subagentName);

  if (shouldBlock) {
    // Claude Code hook contract: {decision:'deny', reason:...} blocks the call.
    // Reason includes remediation guidance so orchestrator can fix and retry.
    const denyReason =
      '[devt dispatch hygiene — BLOCKED] ' + advisory +
      ' Remediation: dispatch via the workflow (/devt:review, /devt:workflow, /devt:debug) which injects the required context blocks, ' +
      'OR set dispatch_hygiene_mode to \"warn\" in .devt/config.json if intentional raw dispatch.';
    process.stdout.write(JSON.stringify({ decision: 'deny', reason: denyReason }));
    process.exit(0);
  }

  // Warn mode (or non-investigative agent in block mode) — emit advisory, allow.
  // Attach the canonical envelope as a structured <canonical_envelope> block
  // (Choice C2) so the orchestrator can copy-paste rather than hand-compose
  // <scope_trust>/<scope_hint>/<memory_signal>/governing_rules/guardrails_inline
  // tags from cached state. Fail-open: any error (no active workflow, no
  // template for this agent, plugin root missing) falls back to advisory-only.
  let envelope = null;
  try {
    const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
    if (pluginRoot) {
      const path = require('path');
      const fs = require('fs');
      const dispatchPath = path.join(pluginRoot, 'bin', 'modules', 'dispatch.cjs');
      if (fs.existsSync(dispatchPath)) {
        const dispatch = require(dispatchPath);
        envelope = dispatch.cmdRenderFilled(subagentName + ':auto');
      }
    }
  } catch { /* fall back to advisory-only — envelope rendering is best-effort */ }

  const advisoryParts = ['[devt dispatch hygiene] ' + advisory];
  if (envelope) {
    advisoryParts.push(
      '',
      'Canonical envelope for this agent (paste into Task() prompt to satisfy the workflow contract):',
      '<canonical_envelope>',
      envelope,
      '</canonical_envelope>'
    );
  }
  const output = JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: advisoryParts.join('\n'),
    },
  });
  process.stdout.write(output);
  process.exit(0);
" -- "$INPUT"
