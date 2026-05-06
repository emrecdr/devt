#!/usr/bin/env bash
# Memory auto-index — PostToolUse hook on Edit/Write touching .devt/memory/**.md.
#
# Phase 3 (v0.18.0). Rebuilds the FTS5 unified index when an ADR/CON/FLOW/REJ/LES
# markdown file is created or modified, so subsequent /devt:memory queries
# always reflect the current state of disk.
#
# Idempotent: if the file isn't under .devt/memory/ or isn't a .md file, no-op.
# If memory.auto_index_on_change is false, no-op.
# Debounced via .devt/memory/.auto-index-stamp — back-to-back hook fires within
# DEVT_AUTO_INDEX_DEBOUNCE_SEC (default 5s) collapse to a single rebuild. This
# matters for the curator's batch-promote pass: writing N approved candidates
# would otherwise trigger N full rebuilds.
# If `memory index` fails, log to stderr but exit 0 — never break the parent
# tool call due to an indexing problem.
[[ $- == *i* ]] && return
set -euo pipefail

INPUT=""
if ! [ -t 0 ]; then
  INPUT="$(timeout 2 cat 2>/dev/null || true)"
fi

if [[ -z "$INPUT" ]]; then
  exit 0
fi

# Decide whether to run, then dispatch. All decisions in node — single subprocess.
node -e "
  const fs = require('fs');
  const path = require('path');
  const { spawnSync } = require('child_process');
  try {
    const d = JSON.parse(process.argv[1]);
    const fp = (d.tool_input || {}).file_path || '';
    if (!fp) process.exit(0);

    // Only fire when the edited file is under .devt/memory/ and ends in .md
    if (!/\\/.devt\\/memory\\/.+\\.md\$/.test(fp)) process.exit(0);

    // Walk up to find project root
    let dir = process.cwd();
    while (dir !== path.dirname(dir)) {
      if (fs.existsSync(path.join(dir, '.devt')) || fs.existsSync(path.join(dir, '.git'))) break;
      dir = path.dirname(dir);
    }

    // Honor memory.auto_index_on_change config (defaults to true)
    let enabled = true;
    try {
      const cfgPath = path.join(dir, '.devt', 'config.json');
      if (fs.existsSync(cfgPath)) {
        const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        if (cfg.memory && cfg.memory.auto_index_on_change === false) enabled = false;
      }
    } catch { /* default true */ }
    if (!enabled) process.exit(0);

    // Debounce: skip if a previous auto-index ran within the window. The stamp
    // file is touched only by this hook, so manual `memory index` calls don't
    // suppress auto-index. Curator batch-promotes (N writes back-to-back) collapse
    // to a single rebuild.
    const debounceSec = Number(process.env.DEVT_AUTO_INDEX_DEBOUNCE_SEC || 5);
    const stampPath = path.join(dir, '.devt', 'memory', '.auto-index-stamp');
    try {
      const st = fs.statSync(stampPath);
      const ageSec = (Date.now() - st.mtimeMs) / 1000;
      if (ageSec < debounceSec) process.exit(0);
    } catch { /* stamp missing — first run, proceed */ }

    // Locate devt-tools.cjs — prefer CLAUDE_PLUGIN_ROOT, fall back to walking up
    const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
    let toolsPath = null;
    if (pluginRoot) {
      const cand = path.join(pluginRoot, 'bin', 'devt-tools.cjs');
      if (fs.existsSync(cand)) toolsPath = cand;
    }
    if (!toolsPath) {
      // Try common locations
      const candidates = [
        path.join(dir, 'bin', 'devt-tools.cjs'), // dev/self-host case
      ];
      for (const c of candidates) if (fs.existsSync(c)) { toolsPath = c; break; }
    }
    if (!toolsPath) {
      // Plugin not located — silent no-op
      process.exit(0);
    }

    const r = spawnSync('node', [toolsPath, 'memory', 'index'], {
      cwd: dir,
      timeout: 15000,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
    if (r.status !== 0) {
      // Log to stderr; do NOT exit non-zero — never break the parent tool call.
      process.stderr.write('[memory-auto-index] memory index exited ' + r.status + ': ' + (r.stderr || '').slice(0, 500) + '\\n');
    } else {
      // Touch the debounce stamp on success so the next hook fire skips if soon.
      try { fs.writeFileSync(stampPath, ''); } catch { /* non-fatal */ }
    }
    process.exit(0);
  } catch { process.exit(0); }
" "$INPUT" 2>/dev/null
