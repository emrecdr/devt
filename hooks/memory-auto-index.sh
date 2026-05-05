#!/usr/bin/env bash
# Memory auto-index — PostToolUse hook on Edit/Write touching .devt/memory/**.md.
#
# Phase 3 (v0.18.0). Rebuilds the FTS5 unified index when an ADR/CON/FLOW/REJ
# markdown file is created or modified, so subsequent /devt:memory queries
# always reflect the current state of disk.
#
# Idempotent: if the file isn't under .devt/memory/ or isn't a .md file, no-op.
# If memory.auto_index_on_change is false, no-op.
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
    }
    process.exit(0);
  } catch { process.exit(0); }
" "$INPUT" 2>/dev/null
