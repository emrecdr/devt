#!/usr/bin/env bash
# Smoke tests for devt CLI — exercises every subcommand with a temp project.
# Used by CI and as a local pre-commit sanity check.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="${ROOT}/bin/devt-tools.cjs"
PASS=0
FAIL=0

pass() { echo "  PASS: $1"; PASS=$((PASS+1)); }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL+1)); }

run() {
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then pass "$name"; else fail "$name ($*)"; fi
}

run_json() {
  local name="$1"; shift
  local out
  if out=$("$@" 2>/dev/null) && echo "$out" | node -e "JSON.parse(require('fs').readFileSync(0,'utf8'))" 2>/dev/null; then
    pass "$name"
  else
    fail "$name ($* — invalid JSON)"
  fi
}

echo "== Manifest validation =="
run_json "plugin.json parses" cat "${ROOT}/.claude-plugin/plugin.json"
run_json "hooks.json parses"  cat "${ROOT}/hooks/hooks.json"

echo "== CLI smoke tests (in temp dir) =="
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cd "$TMP"

run_json "init workflow"   node "$CLI" init workflow "smoke test task"
run_json "init review"     node "$CLI" init review
run_json "state read"      node "$CLI" state read
run_json "config get"      node "$CLI" config get
run_json "models list"     node "$CLI" models list
run_json "models get"      node "$CLI" models get quality
run_json "update local-version" node "$CLI" update local-version
run_json "health"          node "$CLI" health
run_json "semantic status" node "$CLI" semantic status
run_json "report window"   node "$CLI" report window

# setup mutates the project — give it its own subdir so it starts clean
SETUP_TMP="$TMP/setup-test"
mkdir -p "$SETUP_TMP"
run_json "setup --template blank" sh -c "cd '$SETUP_TMP' && node '$CLI' setup --template blank"

echo "== Length cap rejection =="
LONG=$(node -e "process.stdout.write('x'.repeat(60000))")
# Capture both streams; node exits non-zero by design on the throw, which
# would trip pipefail if we used a pipe.
CAP_OUT=$(node "$CLI" init workflow "$LONG" 2>&1 || true)
if echo "$CAP_OUT" | grep -q "exceeds 50000"; then
  pass "50KB cap rejects oversized task"
else
  fail "50KB cap should reject 60KB task — got: ${CAP_OUT:0:100}"
fi

echo "== Concurrent locking =="
# Run from $TMP-independent dir; the test creates its own temp project.
if (cd "$ROOT" && node "$ROOT/scripts/test-locking.cjs" >/dev/null 2>&1); then
  pass "20 concurrent state writes serialize without loss"
else
  fail "concurrent locking test (run scripts/test-locking.cjs for details)"
fi

echo "== Agent size budget =="
# Hard limit per agent file. Largest at v0.9.3 is 387 lines; cap at 500
# leaves room to grow but blocks bloat. Bump deliberately if a future
# agent legitimately needs more.
MAX_AGENT_LINES=500
OVER_BUDGET=()
for agent_file in "$ROOT"/agents/*.md; do
  agent_lines=$(wc -l < "$agent_file")
  if [ "$agent_lines" -gt "$MAX_AGENT_LINES" ]; then
    OVER_BUDGET+=("$(basename "$agent_file"): ${agent_lines} lines")
  fi
done
if [ ${#OVER_BUDGET[@]} -eq 0 ]; then
  pass "all agents within $MAX_AGENT_LINES-line budget"
else
  for entry in "${OVER_BUDGET[@]}"; do
    fail "agent over budget — $entry (limit $MAX_AGENT_LINES)"
  done
fi

echo
echo "== Result: ${PASS} passed, ${FAIL} failed =="
[[ $FAIL -eq 0 ]]
