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

    // Refuse to fire if the target file is NOT a descendant of the resolved
    // project root. Why: edits to /tmp/*.md and ~/.claude/plans/*.md can
    // trip the hook against an unrelated project's scratchpad because the
    // walk-up resolves the cwd-anchored project as root and the hook then
    // requires PREFLIGHT for files outside that project. Out-of-project
    // files are by definition not governed by this project's memory layer.
    //
    // Symlink resolution: macOS exposes /tmp -> /private/tmp and /var ->
    // /private/var. Node's process.cwd() returns the canonical (resolved)
    // form, but tool_input.file_path arrives as the user-visible (unresolved)
    // form. Both sides must be realpath'd before comparison or the descendant
    // check rejects genuinely in-project edits.
    const absFp = path.isAbsolute(fp) ? fp : path.resolve(process.cwd(), fp);
    let canonDir = dir;
    try { canonDir = fs.realpathSync(dir); } catch { /* keep dir as-is */ }
    let canonFp = absFp;
    try {
      // Realpath the parent and rejoin — the target file may not exist yet
      // (Write tool creating new files); only the parent is guaranteed-resolvable.
      const parent = fs.realpathSync(path.dirname(absFp));
      canonFp = path.join(parent, path.basename(absFp));
    } catch { /* parent unresolvable — fall back to absFp */ }
    if (!canonFp.startsWith(canonDir + path.sep)) process.exit(0);

    // Resolve memory.preflight_mode (defaults ← global ← project) AND honor
    // the memory.enabled master switch (when false, the entire memory layer
    // is opted out — guard becomes a no-op).
    let mode = 'warn';
    let sharedCoerce = false;
    try {
      const projectCfgPath = path.join(dir, '.devt', 'config.json');
      if (fs.existsSync(projectCfgPath)) {
        const cfg = JSON.parse(fs.readFileSync(projectCfgPath, 'utf8'));
        if (cfg.memory && cfg.memory.enabled === false) process.exit(0);
        if (cfg.memory && cfg.memory.preflight_mode) mode = cfg.memory.preflight_mode;
        if (cfg.memory && cfg.memory.shared_roots_coerce === true) sharedCoerce = true;
      }
    } catch { /* fall through with default */ }

    if (mode === 'off') process.exit(0);

    // No active workflow → no Brief expected → skip.
    // state.cjs::updateState never deletes workflow.yaml on completion — it
    // sets active=false. Without this active check the hook keeps firing on
    // every Edit indefinitely after a workflow completes, spending tokens on
    // a Brief that no longer applies.
    const wfPath = path.join(dir, '.devt', 'state', 'workflow.yaml');
    if (!fs.existsSync(wfPath)) process.exit(0);
    try {
      const wfBody = fs.readFileSync(wfPath, 'utf8');
      const activeLine = wfBody.split('\\n').find((l) => /^active\\s*:/.test(l));
      if (activeLine && /:\\s*(false|null|~|''|\"\")\\s*\$/.test(activeLine)) process.exit(0);
    } catch { /* malformed YAML — fall through, keep guarding */ }

    // Read scratchpad and check for a PREFLIGHT line that mentions this file
    const scratch = path.join(dir, '.devt', 'state', 'scratchpad.md');
    let body = '';
    try { body = fs.readFileSync(scratch, 'utf8'); } catch { body = ''; }

    // Match PREFLIGHT lines covering this exact file OR its basename
    const fileBase = path.basename(fp);
    const esc = (s) => s.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\\$&');
    const covered = new RegExp('^PREFLIGHT [^\\\\n]*(' + esc(fp) + '|' + esc(fileBase) + ')', 'm').test(body);

    if (covered) {
      // Deny-outcome telemetry: a covered edit following a same-file deny is
      // the guard's success case. Record which class the recovery took so
      // weekly-report can split governed recoveries from ungoverned noise —
      // the funnel must not be silent. Best-effort: failure falls through to
      // plain allow; each deny is resolved at most once.
      try {
        const oLogPath = path.join(dir, '.devt', 'state', 'preflight-denies.jsonl');
        if (fs.existsSync(oLogPath)) {
          const recs = fs.readFileSync(oLogPath, 'utf8').split('\\n').filter(Boolean)
            .map(function (l) { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
          const lastDeny = recs.slice().reverse().find(function (r) { return r.source === 'preflight' && r.file_path === fp; });
          const alreadyResolved = lastDeny && recs.some(function (r) { return r.source === 'deny-outcome' && r.resolves_ts === lastDeny.ts; });
          if (lastDeny && !alreadyResolved) {
            const ungov = new RegExp('^PREFLIGHT [^\\\\n]*(' + esc(fp) + '|' + esc(fileBase) + ')[^\\\\n]*:: ungoverned', 'm').test(body);
            const rec = JSON.stringify({
              source: 'deny-outcome',
              ts: new Date().toISOString(),
              file_path: fp,
              resolves_ts: lastDeny.ts,
              outcome: ungov ? 'recovered-ungoverned' : 'recovered-governed'
            });
            fs.appendFileSync(oLogPath, rec + '\\n');
          }
        }
      } catch { /* telemetry is best-effort — never block the allow */ }
      process.exit(0);
    }

    // Governance check — only short-circuit when a memory layer EXISTS and
    // no doc's affects_paths matches this file. That's the field-observed
    // noise pattern: project has governance set up, edit is on a path no
    // doc covers, hook nags operator to manually write \":: ungoverned\".
    // Auto-write silently instead.
    //
    // Projects WITHOUT a memory layer keep the existing warn behavior — the
    // nudge to set up governance is load-bearing for those. The check uses
    // .devt/memory/index.db as the proxy for \"memory layer initialized\"
    // (same proxy memory.cjs uses for its lookups).
    try {
      const memoryDbPath = path.join(dir, '.devt', 'memory', 'index.db');
      if (fs.existsSync(memoryDbPath)) {
        const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
        if (pluginRoot) {
          const memMod = require(path.join(pluginRoot, 'bin', 'modules', 'memory.cjs'));
          // affects_paths globs are repo-relative; tool_input.file_path is
          // usually ABSOLUTE. Matching the raw path against relative globs
          // finds nothing, mislabels every governed edit \"ungoverned\", and
          // silently disarms the guard. Relativize against the canonical
          // project root (both sides already realpath'd above).
          const relFp = path.relative(canonDir, canonFp);
          const matches = memMod.getByPath(relFp);
          if (!Array.isArray(matches) || matches.length === 0) {
            const ts = new Date().toISOString();
            const action = (d.tool_name || 'edit').toLowerCase();
            const line = 'PREFLIGHT ' + ts + ' ' + action + ' ' + fp + ' :: ungoverned\\n';
            try { fs.appendFileSync(scratch, line); } catch { /* best-effort */ }
            process.exit(0);
          }
          // Trust tier (memory.shared_roots_coerce, default false): shared-root
          // docs advise but do not coerce. When EVERY matching doc is
          // shared-root and coercion has not been granted, log a
          // shared-advisory line and allow — the docs still surface in the
          // Brief; only the deny is withheld. A mixed match set (any local
          // doc) keeps the full deny path. Provenance-unresolvable rows count
          // as local — fail-coercive, preserving prior behavior.
          if (!sharedCoerce) {
            const coercive = matches.filter(function (m) {
              try { return memMod.sourceRootInfo(m.source_root).local; } catch { return true; }
            });
            if (coercive.length === 0) {
              const ids = Array.from(new Set(matches.map(function (m) { return m.id; }))).slice(0, 5).join(',');
              const ts = new Date().toISOString();
              const action = (d.tool_name || 'edit').toLowerCase();
              const line = 'PREFLIGHT ' + ts + ' ' + action + ' ' + fp + ' :: shared-advisory ' + ids + '\\n';
              try { fs.appendFileSync(scratch, line); } catch { /* best-effort */ }
              process.exit(0);
            }
          }
        }
      }
    } catch { /* fall through — default to warn-as-before on lookup failure */ }

    // Build the advisory / block message. Compact — agents with the
    // memory-pre-flight skill loaded already know the protocol; the message
    // needs the action cue + literal format hint for recovery, not the full
    // re-explanation. Recovery cue stays load-bearing for agents that lack
    // the skill (e.g. raw-dispatched code-reviewer).
    const reason = 'PREFLIGHT MISSING for \"' + fp + '\". Add to .devt/state/scratchpad.md then retry:\\n  PREFLIGHT <ts> edit ' + fp + ' :: <ADR/CON/FLOW-ids|ungoverned>\\nIf scope drifted, re-run /devt:preflight \"<refined task>\".';

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
          source: 'preflight',
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
          source: 'preflight',
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
