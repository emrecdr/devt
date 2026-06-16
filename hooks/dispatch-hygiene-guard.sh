#!/usr/bin/env bash
# Dispatch guard — merged PreToolUse hook on Task tool calls.
#
# scope-check + hygiene-check folded into one hook (was two: this file plus
# dispatch-scope-guard.sh). Single subprocess per Task call instead of two.
# Behaviors preserved exactly:
#
#   SCOPE CHECK (advisory, never blocks): warns when prompt bytes or
#   <scope_hint> path count exceeds caps. Fires for ANY Task call.
#   Writes source='dispatch_scope' record + advisory additionalContext.
#   Config: .devt/config.json::dispatch.{max_prompt_bytes,max_files_hint}
#   (defaults 24576 / 12).
#
#   HYGIENE CHECK (may block per config): detects "raw dispatches" where a
#   devt:* subagent is invoked WITHOUT the workflow-managed context blocks
#   (<scope_trust>, <scope_hint>, <memory_signal>, and 7 others). Fires only
#   when subagent_type starts with 'devt:' AND envelope blocks are missing.
#   Writes source='raw_dispatch' record + (per `dispatch_hygiene_mode` config)
#   either a decision:deny block or a warn-mode additionalContext advisory.
#
# Both checks write to .devt/state/dispatch-warnings.jsonl with distinct
# `source` discriminators so /devt:status, mcp-stats --by=source, and
# /devt:debug --mode=forensics can route each class independently.
#
# Output composition:
#   - If hygiene blocks: emit decision:deny (scope advisory is dropped — would
#     have been advisory-only anyway, and the block message takes priority).
#   - If hygiene doesn't block: emit additionalContext combining any scope
#     advisory + hygiene advisory (when present).
#
# Kill switches: DEVT_DISABLED_HOOKS=dispatch-hygiene-guard.sh (env);
# `dispatch_hygiene_mode: "off"` in .devt/config.json (per-project).
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
  const prompt = (input.tool_input || {}).prompt || '';
  if (!prompt) process.exit(0);

  const fs = require('fs');
  const path = require('path');

  // Walk-once: find .devt/state + .devt/config.json in one pass.
  let stateDir = null;
  let cfg = {};
  {
    let dir = process.cwd();
    for (let i = 0; i < 8; i++) {
      const devtDir = path.join(dir, '.devt');
      if (fs.existsSync(devtDir)) {
        const sd = path.join(devtDir, 'state');
        if (fs.existsSync(sd)) stateDir = sd;
        const cfgPath = path.join(devtDir, 'config.json');
        if (fs.existsSync(cfgPath)) {
          try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch { /* malformed — defaults */ }
        }
        break;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  // ============================================================
  // SCOPE CHECK — advisory, fires for any Task call
  // ============================================================
  let scopeAdvisory = null;
  {
    const maxBytes = (cfg.dispatch && typeof cfg.dispatch.max_prompt_bytes === 'number') ? cfg.dispatch.max_prompt_bytes : 24576;
    const maxFiles = (cfg.dispatch && typeof cfg.dispatch.max_files_hint === 'number') ? cfg.dispatch.max_files_hint : 12;
    const promptBytes = Buffer.byteLength(prompt, 'utf8');
    let scopeHintCount = 0;
    const sh = prompt.match(/<scope_hint>([\s\S]*?)<\/scope_hint>/);
    if (sh) {
      try {
        const arr = JSON.parse(sh[1].trim());
        if (Array.isArray(arr)) scopeHintCount = arr.length;
      } catch { /* malformed scope_hint — count stays 0 */ }
    }
    const warnings = [];
    if (promptBytes > maxBytes) {
      warnings.push('dispatch prompt is ' + promptBytes + ' B (cap=' + maxBytes + '); risk of mid-investigation budget exhaustion');
    }
    if (scopeHintCount > maxFiles) {
      warnings.push('scope_hint has ' + scopeHintCount + ' paths (cap=' + maxFiles + '); agent may not finish reading all of them');
    }
    if (warnings.length > 0) {
      // Forensic append — best-effort.
      if (stateDir) {
        try {
          const record = JSON.stringify({
            ts: new Date().toISOString(),
            source: 'dispatch_scope',
            agent: subagent || 'Task',
            prompt_bytes: promptBytes,
            scope_hint_count: scopeHintCount,
            cap_bytes: maxBytes,
            cap_files: maxFiles,
            warnings,
          }) + '\n';
          fs.appendFileSync(path.join(stateDir, 'dispatch-warnings.jsonl'), record);
        } catch { /* log failure non-fatal */ }
      }
      scopeAdvisory = 'DISPATCH-SCOPE [' + (subagent || 'Task') + ']: ' + warnings.join('; ') + ' — advisory; dispatch proceeds. Consider tightening the brief if budget exhaustion occurs.';
    }
  }

  // ============================================================
  // HYGIENE CHECK — may block per dispatch_hygiene_mode config
  // ============================================================
  // Only fire on devt:* subagent dispatches. Other agent types are out of scope.
  if (!subagent.startsWith('devt:')) {
    // Scope advisory still surfaces for non-devt agents.
    if (scopeAdvisory) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: scopeAdvisory },
      }));
    }
    process.exit(0);
  }

  // Workflow-dispatched prompts always carry at least one of these blocks.
  // Raw orchestrator-rolled prompts carry none. The check is intentionally
  // forgiving: ANY of the signals counts as workflow-managed.
  //
  // Content-aware expansion: legitimate hand-injected envelopes (revision
  // dispatches, custom lane fan-out with structured context blocks) were
  // being flagged as raw_dispatch because they use richer structures than
  // the canonical scope_*/memory_signal trio. Expanded the signal set to
  // include any of: context, graph_impact, original_review, lane_scope,
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
      hasProvenance) {
    // Envelope-managed dispatch — hygiene passes. Surface scope advisory if any.
    if (scopeAdvisory) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: scopeAdvisory },
      }));
    }
    process.exit(0);
  }

  // Envelope-not-required agents — per agents/io-contracts.yaml, these
  // agents declare graphify_inputs: [] AND don't consume memory_signal /
  // scope blocks. Their dispatches LEGITIMATELY lack the envelope; without
  // this exemption the hook would over-fire and pollute
  // dispatch-warnings.jsonl with false-positive raw_dispatch records
  // (docs-writer + retro are contracted to receive no envelope).
  // devt-coordinator is a main-thread router with no envelope contract.
  const subagentName = subagent.slice(5);  // strip 'devt:' prefix
  const ENVELOPE_NOT_REQUIRED = new Set(['docs-writer', 'retro', 'curator', 'devt-coordinator']);
  if (ENVELOPE_NOT_REQUIRED.has(subagentName)) {
    if (scopeAdvisory) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: scopeAdvisory },
      }));
    }
    process.exit(0);
  }

  // Raw dispatch detected. Build advisory + forensic record.
  const advisory = [
    'Raw devt:' + subagent.split(':')[1] + ' dispatch detected (no <scope_trust>/<scope_hint>/<memory_signal> blocks in prompt).',
    'This bypasses the workflow contract — Wave 1-4 protections (Graphify-first directive, impact-plan, caller_verification, telemetry surface) only fire when agents are dispatched VIA a devt workflow (/devt:review, /devt:workflow, /devt:debug).',
    'If this is intentional ad-hoc orchestration, the agent will fall back to default behavior (grep-first discovery, no caller-set verification, no telemetry). Consider running /devt:review or /devt:workflow instead.',
  ].join(' ');

  // Forensic append — best-effort, never fails the hook.
  if (stateDir) {
    try {
      const promptPreview = prompt.slice(0, 200).replace(/\n+/g, ' ');
      const record = JSON.stringify({
        ts: new Date().toISOString(),
        source: 'raw_dispatch',
        agent: subagent,
        prompt_bytes: Buffer.byteLength(prompt, 'utf8'),
        prompt_preview: promptPreview,
      });
      fs.appendFileSync(path.join(stateDir, 'dispatch-warnings.jsonl'), record + '\n');
    } catch { /* forensic write failure must NEVER affect the hook */ }
  }

  // L1 — read dispatch_hygiene_mode. Defaults to 'block' (fail-secure).
  let mode = 'block';
  if (cfg && typeof cfg.dispatch_hygiene_mode === 'string') {
    mode = cfg.dispatch_hygiene_mode.toLowerCase();
  }

  if (mode === 'off') {
    // 'off' suppresses hygiene advisory but scope advisory still surfaces.
    if (scopeAdvisory) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: scopeAdvisory },
      }));
    }
    process.exit(0);
  }

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
    // Scope advisory is dropped here — would have been advisory-only and the
    // block message takes priority.
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
      const dispatchPath = path.join(pluginRoot, 'bin', 'modules', 'dispatch.cjs');
      if (fs.existsSync(dispatchPath)) {
        const dispatch = require(dispatchPath);
        envelope = dispatch.cmdRenderFilled(subagentName + ':auto');
      }
    }
  } catch { /* fall back to advisory-only — envelope rendering is best-effort */ }

  const advisoryParts = [];
  if (scopeAdvisory) advisoryParts.push(scopeAdvisory);
  advisoryParts.push('[devt dispatch hygiene] ' + advisory);
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
