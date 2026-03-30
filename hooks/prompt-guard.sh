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

# Scan for injection patterns (11 known patterns)
WARNINGS=""

# Instruction overrides
if echo "$CONTENT" | grep -qiE "ignore (all |any )?(previous |prior |above )?instructions"; then
  WARNINGS="${WARNINGS}\n- Instruction override pattern detected"
fi
if echo "$CONTENT" | grep -qiE "you are now|new role|act as|pretend to be"; then
  WARNINGS="${WARNINGS}\n- Role manipulation pattern detected"
fi
if echo "$CONTENT" | grep -qiE "system prompt|reveal.*instructions|show.*system"; then
  WARNINGS="${WARNINGS}\n- System prompt extraction attempt detected"
fi
if echo "$CONTENT" | grep -qiE "output.*verbatim|repeat.*above|echo.*system"; then
  WARNINGS="${WARNINGS}\n- Verbatim extraction pattern detected"
fi
if echo "$CONTENT" | grep -qiE "<system>|<\/system>|\[INST\]|\[\/INST\]"; then
  WARNINGS="${WARNINGS}\n- Prompt markup injection detected"
fi
if echo "$CONTENT" | grep -qiE "base64|atob|btoa"; then
  WARNINGS="${WARNINGS}\n- Base64 encoding pattern detected"
fi

# Check for invisible Unicode characters (cross-platform, no grep -P dependency)
if node -e "process.exit(/[\u200B\u200C\u200D\uFEFF\u00AD\u2060]/.test(process.argv[1]) ? 0 : 1)" "$CONTENT" 2>/dev/null; then
  WARNINGS="${WARNINGS}\n- Invisible Unicode characters detected"
fi

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
