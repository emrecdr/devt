#!/usr/bin/env bash
# Run quality gates defined in .devt/rules/quality-gates.md.
# Extracts bash commands from fenced code blocks and executes each.
# Reports pass/fail per command and exits non-zero if any gate fails.
#
# NOTE: set -e is intentionally omitted — individual gate failures are expected
# and caught by the if/else around bash -c. Adding -e would abort after first failure.
set -uo pipefail

# Allowlist of safe command prefixes for quality gate execution.
# Commands not matching any prefix are rejected.
ALLOWED_PREFIXES=(
  "npm " "npx " "yarn " "pnpm "
  "go " "golangci-lint " "staticcheck "
  "uv " "python " "python3 " "pip " "ruff " "mypy " "pytest " "flake8 " "black " "isort "
  "cargo " "rustfmt " "clippy"
  "make " "gradle " "mvn "
  "eslint " "prettier " "tsc " "vitest " "jest "
  "dotnet " "swift " "dart " "flutter "
  "shellcheck " "hadolint "
)

validate_command() {
  local cmd="$1"
  # Strip leading whitespace
  cmd="${cmd#"${cmd%%[![:space:]]*}"}"
  # Reject empty commands
  [[ -z "$cmd" ]] && return 1
  # Reject shell metacharacters that allow command chaining/injection
  if echo "$cmd" | grep -qE '[;|&`$><]|\$\('; then
    return 1
  fi
  # Check against allowlist
  for prefix in "${ALLOWED_PREFIXES[@]}"; do
    if [[ "$cmd" == "$prefix"* || "$cmd" == "$prefix" ]]; then
      return 0
    fi
  done
  return 1
}

# Validate a multi-line command buffer — every non-empty line must pass
validate_block() {
  local block="$1"
  while IFS= read -r line; do
    # Skip empty lines and comments
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    if ! validate_command "$line"; then
      echo "    Rejected line: $line"
      return 1
    fi
  done <<< "$block"
  return 0
}

QUALITY_GATES=".devt/rules/quality-gates.md"

if [[ ! -f "$QUALITY_GATES" ]]; then
  echo "No quality gates file found at $QUALITY_GATES"
  echo "Run /devt:init to scaffold .devt/rules/ first."
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
      if validate_block "$CMD_BUFFER"; then
        if bash -c "$CMD_BUFFER"; then
          echo "    PASS"
          PASSED=$((PASSED + 1))
        else
          echo "    FAIL (exit code: $?)"
          FAILED=$((FAILED + 1))
        fi
      else
        echo "    SKIP (command not in allowlist)"
        echo "    Rejected: $CMD_BUFFER"
        echo "    Add the command prefix to ALLOWED_PREFIXES in run-quality-gates.sh"
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
