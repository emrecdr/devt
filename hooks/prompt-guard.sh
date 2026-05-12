#!/usr/bin/env bash
# Prompt injection guard — scans .devt/state/ writes for injection patterns
# Advisory only: warns but does not block operations
[[ $- == *i* ]] && return
set -euo pipefail

# Read hook input from stdin (with timeout)
INPUT=""
if ! [ -t 0 ]; then
  INPUT="$(timeout 3 cat 2>/dev/null || true)"
fi

# Only check Write/Edit to .devt/state/ paths
if [[ -z "$INPUT" ]]; then
  exit 0
fi

# Extract file path from hook input
FILE_PATH=$(node -e "
  try {
    const d = JSON.parse(process.argv[1]);
    const input = d.tool_input || {};
    console.log(input.file_path || input.path || '');
  } catch { console.log(''); }
" "$INPUT" 2>/dev/null)

# Only guard .devt/state/ files
if [[ "$FILE_PATH" != *".devt/state/"* && "$FILE_PATH" != *".devt/rules/"* ]]; then
  exit 0
fi

# Extract content being written
CONTENT=$(node -e "
  try {
    const d = JSON.parse(process.argv[1]);
    const input = d.tool_input || {};
    console.log(input.content || input.new_string || '');
  } catch { console.log(''); }
" "$INPUT" 2>/dev/null)

if [[ -z "$CONTENT" ]]; then
  exit 0
fi

# Scan for injection patterns + invisible-Unicode in a SINGLE Node subprocess
# (was 6 grep shellouts + 1 Node = 7 subprocesses per Edit/Write to .devt/state/).
# Each grep was 5-10ms warm; consolidation drops the per-write hook latency to
# one process spawn. Patterns mirror the prior bash regex set verbatim.
WARNINGS=$(node -e "
  const content = process.argv[1] || '';
  const checks = [
    [/ignore (all |any )?(previous |prior |above )?instructions/i, 'Instruction override pattern detected'],
    [/you are now|new role|act as|pretend to be/i,                'Role manipulation pattern detected'],
    [/system prompt|reveal.*instructions|show.*system/i,          'System prompt extraction attempt detected'],
    [/output.*verbatim|repeat.*above|echo.*system/i,              'Verbatim extraction pattern detected'],
    [/<system>|<\/system>|\[INST\]|\[\/INST\]/i,                  'Prompt markup injection detected'],
    [/base64|atob|btoa/i,                                          'Base64 encoding pattern detected'],
    [/[\u200B\u200C\u200D\uFEFF\u00AD\u2060]/,                    'Invisible Unicode characters detected'],
  ];
  const hits = [];
  for (const [re, label] of checks) {
    if (re.test(content)) hits.push('- ' + label);
  }
  if (hits.length) process.stdout.write(hits.join('\\n'));
" "$CONTENT" 2>/dev/null || true)

if [[ -n "$WARNINGS" ]]; then
  # Advisory warning — do NOT block
  CONTEXT="SECURITY WARNING: Potential prompt injection detected in write to ${FILE_PATH}:${WARNINGS}\nReview the content before proceeding. This is advisory — the write was NOT blocked."

  node -e "
    const ctx = process.argv[1];
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: ctx
      }
    }));
  " "$CONTEXT"
else
  exit 0
fi
