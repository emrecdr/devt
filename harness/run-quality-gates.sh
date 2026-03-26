#!/usr/bin/env bash
# Run quality gates defined in .dev-rules/quality-gates.md.
# Extracts bash commands from fenced code blocks and executes each.
# Reports pass/fail per command and exits non-zero if any gate fails.
set -uo pipefail

QUALITY_GATES=".dev-rules/quality-gates.md"

if [[ ! -f "$QUALITY_GATES" ]]; then
  echo "No quality gates file found at $QUALITY_GATES"
  echo "Run 'init-dev-rules.sh' to scaffold .dev-rules/ first."
  exit 1
fi

PASSED=0
FAILED=0
TOTAL=0
IN_BLOCK=false

while IFS= read -r line; do
  # Detect start of bash/sh code block
  if [[ "$IN_BLOCK" == false ]] && echo "$line" | grep -qE '^\s*```(bash|sh)\s*$'; then
    IN_BLOCK=true
    CMD_BUFFER=""
    continue
  fi

  # Detect end of code block
  if [[ "$IN_BLOCK" == true ]] && echo "$line" | grep -qE '^\s*```\s*$'; then
    IN_BLOCK=false
    if [[ -n "$CMD_BUFFER" ]]; then
      TOTAL=$((TOTAL + 1))
      echo "--- Gate $TOTAL: $CMD_BUFFER"
      if eval "$CMD_BUFFER"; then
        echo "    PASS"
        PASSED=$((PASSED + 1))
      else
        echo "    FAIL (exit code: $?)"
        FAILED=$((FAILED + 1))
      fi
      echo ""
    fi
    continue
  fi

  # Accumulate lines inside code block
  if [[ "$IN_BLOCK" == true ]]; then
    if [[ -n "$CMD_BUFFER" ]]; then
      CMD_BUFFER="${CMD_BUFFER}
${line}"
    else
      CMD_BUFFER="$line"
    fi
  fi
done < "$QUALITY_GATES"

echo "=== Quality Gates: $PASSED/$TOTAL passed, $FAILED failed ==="

if [[ $FAILED -gt 0 ]]; then
  exit 1
fi

if [[ $TOTAL -eq 0 ]]; then
  echo "Warning: No bash code blocks found in $QUALITY_GATES"
  exit 0
fi
