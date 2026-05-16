#!/usr/bin/env bash
# Pre-flight guard — PreToolUse hook on Edit/Write/NotebookEdit.
#
# Phase 3. Checks .devt/state/scratchpad.md for a PREFLIGHT line
# covering the target file path. Behavior governed by memory.preflight_mode:
# off — no-op (skip entirely)
# warn — Phase 3 default — emit stderr advisory, do NOT block
# block — Phase 4 default — deny the tool call with a checklist message
#
# The scratchpad PREFLIGHT line format (per skills/memory-pre-flight/SKILL.md):
# PREFLIGHT <ISO-timestamp> <action> <file_path> :: <governing IDs or notes>
#
# Hook exits with:
# 0 + JSON output → tool call proceeds (default warn mode)
# {decision: "deny"} JSON in stdout → blocks the call (block mode only)
#
# Reads JSON hook input from stdin. Robust to malformed input — fails-open
# (returns 0) on any parse error, never blocks legitimate work due to a hook bug.
[[ $- == *i* ]] && return
set -euo pipefail

INPUT=""
if ! [ -t 0 ]; then
  INPUT="$(timeout 3 cat 2>/dev/null || true)"
fi

if [[ -z "$INPUT" ]]; then
  exit 0
fi

# Single Node call: parse hook input, read merged config + scratchpad, decide.
# Defense-in-depth — even on parse failure, exit 0 so we don't block.
node -e "
  const fs = require('fs');
  const path = require('path');
  try {
    const d = JSON.parse(process.argv[1]);
    const fp = (d.tool_input || {}).file_path || '';
    if (!fp) process.exit(0);

    // Skip files in .devt/state/ — those are agent scratch, not source.
    if (fp.includes('/.devt/state/')) process.exit(0);

    // Find project root: walk up until we see .devt/ or .git/
    let dir = process.cwd();
    while (dir !== path.dirname(dir)) {
      if (fs.existsSync(path.join(dir, '.devt')) || fs.existsSync(path.join(dir, '.git'))) break;
      dir = path.dirname(dir);
    }

    // Resolve memory.preflight_mode (defaults ← global ← project) AND honor
    // the memory.enabled master switch (when false, the entire memory layer
    // is opted out — guard becomes a no-op).
    let mode = 'warn';
    try {
      const projectCfgPath = path.join(dir, '.devt', 'config.json');
      if (fs.existsSync(projectCfgPath)) {
        const cfg = JSON.parse(fs.readFileSync(projectCfgPath, 'utf8'));
        if (cfg.memory && cfg.memory.enabled === false) process.exit(0);
        if (cfg.memory && cfg.memory.preflight_mode) mode = cfg.memory.preflight_mode;
      }
    } catch { /* fall through with default */ }

    if (mode === 'off') process.exit(0);

    // No active workflow → no Brief expected → skip
    const wfPath = path.join(dir, '.devt', 'state', 'workflow.yaml');
    if (!fs.existsSync(wfPath)) process.exit(0);

    // Read scratchpad and check for a PREFLIGHT line that mentions this file
    const scratch = path.join(dir, '.devt', 'state', 'scratchpad.md');
    let body = '';
    try { body = fs.readFileSync(scratch, 'utf8'); } catch { body = ''; }

    // Match PREFLIGHT lines covering this exact file OR its basename
    const fileBase = path.basename(fp);
    const esc = (s) => s.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\\$&');
    const covered = new RegExp('^PREFLIGHT [^\\\\n]*(' + esc(fp) + '|' + esc(fileBase) + ')', 'm').test(body);

    if (covered) process.exit(0);

    // Build the advisory / block message
    const reason = 'DENIED: edit to \"' + fp + '\" requires a PREFLIGHT line in .devt/state/scratchpad.md.\n\nAppend this line to scratchpad.md BEFORE retrying:\n  PREFLIGHT <ISO-8601-timestamp> edit ' + fp + ' :: <governing-ADR/CON/FLOW-IDs>\n\nIf no memory doc governs this path, use the keyword \\'ungoverned\\':\n  PREFLIGHT <ISO-8601-timestamp> edit ' + fp + ' :: ungoverned\n\nSee skills/memory-pre-flight/SKILL.md for the full protocol. If the file is outside the current Brief\\'s scope, run /devt:preflight \"<refined task>\" to regenerate the Brief.';

    // Forensic logging: append every deny/warn as one JSON record per line
    // via bin/modules/logger.cjs::appendJsonl. Survives state reset via the
    // archive ring buffer. Hook stays stateless — log is append-only side-effect.
    // Wrapped in try-catch so log failure never blocks the deny path.
    try {
      // CLAUDE_PLUGIN_ROOT is set by Claude Code when the plugin loads; the
      // hook inherits it from the bash parent. Fall back to the hook script's
      // own location (../../) for direct-invocation test scenarios.
      const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
      const loggerPath = pluginRoot
        ? path.join(pluginRoot, 'bin', 'modules', 'logger.cjs')
        : null;
      const logPath = path.join(dir, '.devt', 'state', 'preflight-denies.jsonl');
      if (loggerPath && fs.existsSync(loggerPath)) {
        const { appendJsonl } = require(loggerPath);
        appendJsonl(logPath, {
          mode: mode,
          ts: new Date().toISOString(),
          action: (d.tool_name || 'edit').toLowerCase(),
          file_path: fp,
          reason: 'missing PREFLIGHT line',
        });
      } else {
        // Fallback: append the JSON line directly without the helper. Same
        // JSONL format. Used when CLAUDE_PLUGIN_ROOT isn't set (e.g. direct
        // test invocation of the hook outside Claude Code).
        const rec = JSON.stringify({
          mode: mode,
          ts: new Date().toISOString(),
          action: (d.tool_name || 'edit').toLowerCase(),
          file_path: fp,
          reason: 'missing PREFLIGHT line',
        });
        fs.appendFileSync(logPath, rec + '\\n');
      }
    } catch { /* never block on log failure */ }

    if (mode === 'block') {
      // PreToolUse deny — JSON to stdout per Claude Code hook spec
      process.stdout.write(JSON.stringify({
        decision: 'deny',
        reason,
        hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: reason }
      }));
      process.exit(0);
    }

    // warn mode: emit advisory but allow the edit
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: '⚠️ ' + reason + ' (Pre-Flight in WARN mode — edit will proceed; flip to BLOCK in .devt/config.json:memory.preflight_mode when ready.)' }
    }));
    process.exit(0);
  } catch { process.exit(0); }
" "$INPUT" 2>/dev/null
