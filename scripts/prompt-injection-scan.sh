#!/usr/bin/env bash
set -euo pipefail

# Prompt injection scanner for devt plugin markdown files.
# Scans for injection patterns that could compromise agent behavior.
#
# Usage:
#   scripts/prompt-injection-scan.sh              # Scan all plugin .md files
#   scripts/prompt-injection-scan.sh --diff       # Scan only changed files (for CI)
#   scripts/prompt-injection-scan.sh --file FILE  # Scan a single file
#
# Exit codes:
#   0 = clean
#   1 = findings detected

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODE="all"
TARGET=""
FINDINGS=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --diff) MODE="diff"; shift ;;
    --file) MODE="file"; TARGET="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

scan_file() {
  local file="$1"
  local relpath="${file#$PLUGIN_ROOT/}"
  local found=0

  # 1. Instruction override patterns
  if grep -qiE "ignore (all |any )?(previous |prior |above )?instructions" "$file"; then
    echo "INJECTION: $relpath — instruction override pattern"
    found=1
  fi

  # 2. Role manipulation
  if grep -qiE "you are now|new role:|act as|pretend to be|from now on you" "$file"; then
    # Skip legitimate agent role definitions (frontmatter + "You are a" in agent files)
    local count
    count=$(grep -ciE "you are now|new role:|pretend to be|from now on you" "$file" || true)
    if [[ "$count" -gt 0 ]]; then
      echo "INJECTION: $relpath — role manipulation pattern ($count occurrences)"
      found=1
    fi
  fi

  # 3. System boundary injection
  if grep -qiE "<system>|</system>|\[INST\]|\[/INST\]|\[SYSTEM\]|<\|im_start\|>" "$file"; then
    echo "INJECTION: $relpath — system boundary injection"
    found=1
  fi

  # 4. Tool call injection (fake tool outputs)
  if grep -qiE "<tool_result>|<function_call>|<invoke|<tool_use>" "$file"; then
    echo "INJECTION: $relpath — tool call injection pattern"
    found=1
  fi

  # 5. Base64 obfuscation (blobs >= 40 chars that aren't data URIs)
  if grep -qoE '[A-Za-z0-9+/]{40,}={0,2}' "$file" 2>/dev/null; then
    local b64_count
    b64_count=$(grep -coE '[A-Za-z0-9+/]{40,}={0,2}' "$file" 2>/dev/null || true)
    # Skip data URIs and known safe patterns
    local non_uri
    non_uri=$(grep -oE '[A-Za-z0-9+/]{40,}={0,2}' "$file" 2>/dev/null | grep -v "^data:" | wc -l | tr -d ' ')
    if [[ "$non_uri" -gt 0 ]]; then
      echo "SUSPICIOUS: $relpath — $non_uri base64-like blob(s) detected (review manually)"
      found=1
    fi
  fi

  # 6. Secret patterns (skip files in patterns/ — they contain documented examples)
  if [[ "$relpath" != *"/patterns/"* ]]; then
    if grep -qiE "(AKIA[0-9A-Z]{16}|sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36}|sk_live_|-----BEGIN (RSA |EC )?PRIVATE KEY)" "$file"; then
      echo "SECRET: $relpath — potential secret/key detected"
      found=1
    fi
  fi

  if [[ "$found" -gt 0 ]]; then
    FINDINGS=$((FINDINGS + found))
  fi
}

# Collect files to scan
FILES=()

case "$MODE" in
  all)
    while IFS= read -r f; do
      FILES+=("$f")
    done < <(find "$PLUGIN_ROOT" -name "*.md" -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null)
    ;;
  diff)
    while IFS= read -r f; do
      [[ "$f" == *.md ]] && FILES+=("$PLUGIN_ROOT/$f")
    done < <(git diff --name-only HEAD~1 2>/dev/null || git diff --name-only --cached 2>/dev/null || true)
    ;;
  file)
    [[ -f "$TARGET" ]] && FILES+=("$TARGET")
    ;;
esac

echo "Scanning ${#FILES[@]} markdown files..."
echo

for file in "${FILES[@]}"; do
  [[ -f "$file" ]] && scan_file "$file"
done

echo
if [[ "$FINDINGS" -gt 0 ]]; then
  echo "RESULT: $FINDINGS finding(s) detected. Review before merging."
  exit 1
else
  echo "RESULT: Clean — no injection patterns found."
  exit 0
fi
