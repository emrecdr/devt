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
  [[ -z "$cmd" ]] && { VALIDATE_REASON="empty command"; return 1; }
  # Reject shell metacharacters that allow command chaining/injection
  if echo "$cmd" | grep -qE '[;|&`$><]|\$\('; then
    VALIDATE_REASON="shell metacharacter (;, |, &, \`, \$, <, > or \$()) — split into separate gate blocks; chaining is rejected by the security validator"
    return 1
  fi
  # Check against allowlist
  for prefix in "${ALLOWED_PREFIXES[@]}"; do
    if [[ "$cmd" == "$prefix"* || "$cmd" == "$prefix" ]]; then
      return 0
    fi
  done
  VALIDATE_REASON="command prefix not in ALLOWED_PREFIXES — add it to scripts/run-quality-gates.sh if it's safe"
  return 1
}

# Validate a multi-line command buffer — every non-empty line must pass.
# On failure, the offending line + reason are surfaced via VALIDATE_REASON.
validate_block() {
  local block="$1"
  VALIDATE_REASON=""
  while IFS= read -r line; do
    # Skip empty lines and comments
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    if ! validate_command "$line"; then
      VALIDATE_REASON="line: $line — $VALIDATE_REASON"
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
BLOCK_PARALLEL=false

# Pending parallel batch: arrays of buffered blocks waiting to run together.
# Consecutive blocks tagged `parallel` accumulate here and flush as a single
# concurrent batch when a non-parallel block (or EOF) is encountered.
BATCH_CMDS=()

run_block() {
  # Run a single validated block sequentially. Updates PASSED/FAILED/TOTAL.
  local block="$1"
  TOTAL=$((TOTAL + 1))
  echo "--- Gate $TOTAL: $block"
  if validate_block "$block"; then
    if bash -c "$block"; then
      echo "    PASS"
      PASSED=$((PASSED + 1))
    else
      echo "    FAIL (exit code: $?)"
      FAILED=$((FAILED + 1))
    fi
  else
    echo "    REJECTED: $VALIDATE_REASON"
    FAILED=$((FAILED + 1))
  fi
  echo ""
}

flush_batch() {
  # Execute all buffered parallel-tagged blocks concurrently. Each block's
  # stdout/stderr is captured to a temp file and replayed after `wait` so
  # output stays per-gate readable even when commands run in parallel.
  local n="${#BATCH_CMDS[@]}"
  [[ "$n" -eq 0 ]] && return 0
  if [[ "$n" -eq 1 ]]; then
    # Single block in batch — no concurrency benefit, run sequentially.
    run_block "${BATCH_CMDS[0]}"
    BATCH_CMDS=()
    return 0
  fi

  echo "--- Parallel batch ($n gates)"
  local pids=()
  local outs=()
  local validated=()
  local i
  local reasons=()
  for i in "${!BATCH_CMDS[@]}"; do
    local block="${BATCH_CMDS[$i]}"
    if validate_block "$block"; then
      local out
      out=$(mktemp)
      outs+=("$out")
      validated+=(1)
      reasons+=("")
      bash -c "$block" >"$out" 2>&1 &
      pids+=($!)
    else
      outs+=("")
      validated+=(0)
      reasons+=("$VALIDATE_REASON")
      pids+=(0)
    fi
  done

  # Wait + collect results in submission order.
  for i in "${!BATCH_CMDS[@]}"; do
    local block="${BATCH_CMDS[$i]}"
    TOTAL=$((TOTAL + 1))
    echo "--- Gate $TOTAL [parallel]: $block"
    if [[ "${validated[$i]}" -eq 0 ]]; then
      echo "    REJECTED: ${reasons[$i]}"
      FAILED=$((FAILED + 1))
      echo ""
      continue
    fi
    local pid="${pids[$i]}"
    local out="${outs[$i]}"
    local ec=0
    wait "$pid" || ec=$?
    cat "$out"
    rm -f "$out"
    if [[ "$ec" -eq 0 ]]; then
      echo "    PASS"
      PASSED=$((PASSED + 1))
    else
      echo "    FAIL (exit code: $ec)"
      FAILED=$((FAILED + 1))
    fi
    echo ""
  done

  BATCH_CMDS=()
}

while IFS= read -r line; do
  # Detect start of bash/sh code block. Optional `parallel` info-string after
  # the language: ```bash parallel  →  block joins the next concurrent batch.
  if [[ "$IN_BLOCK" == false ]]; then
    if echo "$line" | grep -qE '^\s*```(bash|sh)\s+parallel\s*$'; then
      IN_BLOCK=true
      BLOCK_PARALLEL=true
      CMD_BUFFER=""
      continue
    elif echo "$line" | grep -qE '^\s*```(bash|sh)\s*$'; then
      IN_BLOCK=true
      BLOCK_PARALLEL=false
      CMD_BUFFER=""
      continue
    fi
  fi

  # Detect end of code block
  if [[ "$IN_BLOCK" == true ]] && echo "$line" | grep -qE '^\s*```\s*$'; then
    IN_BLOCK=false
    if [[ -n "$CMD_BUFFER" ]]; then
      if [[ "$BLOCK_PARALLEL" == true ]]; then
        BATCH_CMDS+=("$CMD_BUFFER")
      else
        flush_batch
        run_block "$CMD_BUFFER"
      fi
    fi
    BLOCK_PARALLEL=false
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

# Flush any trailing parallel batch (parallel blocks at EOF with no
# sequential block after to trigger the flush).
flush_batch

echo "=== Quality Gates: $PASSED/$TOTAL passed, $FAILED failed ==="

if [[ $FAILED -gt 0 ]]; then
  exit 1
fi

if [[ $TOTAL -eq 0 ]]; then
  echo "Warning: No bash code blocks found in $QUALITY_GATES"
  exit 0
fi
