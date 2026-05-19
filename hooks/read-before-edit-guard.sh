#!/usr/bin/env bash
# Read-before-edit guard — reminds agents to Read files before Editing them
# Advisory only: outputs a warning but does NOT block the edit
[[ $- == *i* ]] && return
set -euo pipefail

# Read hook input from stdin (with timeout)
INPUT=""
if ! [ -t 0 ]; then
  INPUT="$(timeout 3 cat 2>/dev/null || true)"
fi

if [[ -z "$INPUT" ]]; then
  exit 0
fi

# Single node call: parse input, check file exists, emit advisory if needed
node -e "
  const fs = require('fs');
  try {
    const d = JSON.parse(process.argv[1]);
    const fp = (d.tool_input || {}).file_path || '';
    if (!fp || !fs.existsSync(fp)) process.exit(0);
    const name = require('path').basename(fp);
    const ctx = 'Reminder: if \"' + name + '\" has not been Read in this session, Read it first — the runtime requires it before Edit.';
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: ctx } }));
  } catch { process.exit(0); }
" "$INPUT" 2>/dev/null
