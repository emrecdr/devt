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
run_json "semantic query (no playbook)"  node "$CLI" semantic query "smoke" --min-importance=5 --limit=3
run_json "report window"   node "$CLI" report window

echo "== semantic query rejects unknown flag =="
BAD_FLAG_OUT=$(node "$CLI" semantic query "x" --bogus 2>&1 || true)
if echo "$BAD_FLAG_OUT" | grep -q "Unknown flag"; then
  echo "PASS: unknown flag rejected"
else
  echo "FAIL: unknown flag was accepted"
  echo "$BAD_FLAG_OUT"
  exit 1
fi

echo "== semantic query rejects out-of-range value =="
BAD_VAL_OUT=$(node "$CLI" semantic query "x" --min-importance=99 2>&1 || true)
if echo "$BAD_VAL_OUT" | grep -q "must be 1-10"; then
  echo "PASS: out-of-range importance rejected"
else
  echo "FAIL: out-of-range importance was accepted"
  echo "$BAD_VAL_OUT"
  exit 1
fi

echo "== parsePlaybook accepts both flat and YAML-list entry forms =="
PARSER_TMP="$TMP/parser-test"
mkdir -p "$PARSER_TMP/.devt"
cat > "$PARSER_TMP/.devt/learning-playbook.md" <<'EOF_PB'
- description: YAML-list form (matches schema example)
  category: testing
  importance: 7
  tags: "testing"

---

description: Flat form
category: architecture
importance: 8
tags: "architecture"
EOF_PB
# Drop stderr — Node 22 emits "ExperimentalWarning: SQLite is an experimental
# feature" on first node:sqlite require, which would otherwise pollute the
# JSON capture. Local dev may not see this; CI runners do.
PARSER_OUT=$(cd "$PARSER_TMP" && node "$CLI" semantic sync 2>/dev/null)
SYNCED=$(echo "$PARSER_OUT" | node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync(0,'utf8')).synced))" 2>/dev/null || echo 0)
if [[ "$SYNCED" == "2" ]]; then
  pass "parser handles both '- key: val' and 'key: val' forms (synced 2/2)"
else
  fail "parser regression — synced=$SYNCED, expected 2; output: $PARSER_OUT"
fi
# Clean the DB the test populated, otherwise it pollutes other smoke runs.
rm -rf "$ROOT/memory/semantic/lessons.db" 2>/dev/null

echo "== python-fastapi reference arch-scan: clean project produces zero findings =="
SCAN_TMP="$TMP/arch-scan-clean"
mkdir -p "$SCAN_TMP/app/services/clean/domain"
cat > "$SCAN_TMP/app/services/clean/domain/entities.py" <<'EOF_PY'
class CleanEntity:
    pass
EOF_PY
SCAN_OUT=$(cd "$SCAN_TMP" && python3 "$ROOT/templates/python-fastapi/arch-scan.py" --json 2>/dev/null) || SCAN_EC=$?
SCAN_FINDINGS=$(echo "$SCAN_OUT" | python3 -c "import json,sys; print(len(json.load(sys.stdin)['findings']))" 2>/dev/null || echo "INVALID")
if [[ "${SCAN_EC:-0}" -eq 0 ]] && [[ "$SCAN_FINDINGS" == "0" ]]; then
  pass "arch-scan on clean project: 0 findings, exit 0"
else
  fail "arch-scan regression: exit=${SCAN_EC:-0}, findings=$SCAN_FINDINGS"
  echo "$SCAN_OUT"
fi

echo "== python-fastapi reference arch-scan: violations detected and exit non-zero =="
SCAN_TMP2="$TMP/arch-scan-dirty"
mkdir -p "$SCAN_TMP2/app/services/photos/domain"
mkdir -p "$SCAN_TMP2/app/services/photos/application"
cat > "$SCAN_TMP2/app/services/photos/domain/models.py" <<'EOF_PY'
from app.services.photos.infrastructure.repositories import PhotoRepository
class Photo: pass
EOF_PY
cat > "$SCAN_TMP2/app/services/photos/application/service.py" <<'EOF_PY'
from sqlalchemy.orm import Session
class PhotoService: pass
EOF_PY
SCAN_OUT2=$(cd "$SCAN_TMP2" && python3 "$ROOT/templates/python-fastapi/arch-scan.py" --json 2>/dev/null) || SCAN_EC2=$?
CRIT=$(echo "$SCAN_OUT2" | python3 -c "import json,sys; print(sum(1 for f in json.load(sys.stdin)['findings'] if f['severity']=='critical'))" 2>/dev/null || echo "0")
HIGH=$(echo "$SCAN_OUT2" | python3 -c "import json,sys; print(sum(1 for f in json.load(sys.stdin)['findings'] if f['severity']=='high'))" 2>/dev/null || echo "0")
if [[ "${SCAN_EC2:-0}" -eq 1 ]] && [[ "$CRIT" -ge "1" ]] && [[ "$HIGH" -ge "1" ]]; then
  pass "arch-scan on dirty project: $CRIT critical + $HIGH high finding(s), exit 1"
else
  fail "arch-scan dirty regression: exit=${SCAN_EC2:-0}, critical=$CRIT, high=$HIGH"
  echo "$SCAN_OUT2"
fi

echo "== run-quality-gates.sh: rejection reasons are precise =="
RQG_TMP="$TMP/reject-test"
mkdir -p "$RQG_TMP/.devt/rules"
cat > "$RQG_TMP/.devt/rules/quality-gates.md" <<'EOF_QG'
```bash
echo "first" && echo "second"
```

```bash
forbidden_tool --doit
```
EOF_QG
RQG_OUT=$(cd "$RQG_TMP" && bash "$ROOT/scripts/run-quality-gates.sh" 2>&1) || true
if echo "$RQG_OUT" | grep -q "shell metacharacter" && echo "$RQG_OUT" | grep -q "not in ALLOWED_PREFIXES"; then
  pass "rejection reasons distinguish metacharacter vs allowlist"
else
  fail "rejection messages did not surface both reasons. Output:"
  echo "$RQG_OUT"
fi


# setup mutates the project — give it its own subdir so it starts clean
SETUP_TMP="$TMP/setup-test"
mkdir -p "$SETUP_TMP"
run_json "setup --template blank" sh -c "cd '$SETUP_TMP' && node '$CLI' setup --template blank"

# python-fastapi includes a .py file (arch-scan.py) alongside the .md rules,
# exercising a code path that --template blank doesn't (mixed-extension copy).
# Use an ISOLATED temp dir outside $TMP so findProjectRoot doesn't walk up
# into the .devt/ created earlier by init-workflow.
SETUP_TMP_PY=$(mktemp -d)
( cd "$SETUP_TMP_PY" && node "$CLI" setup --template python-fastapi >/dev/null 2>&1 )
if [[ -f "$SETUP_TMP_PY/.devt/rules/arch-scan.py" ]] && [[ -f "$SETUP_TMP_PY/.devt/rules/coding-standards.md" ]]; then
  pass "setup --template python-fastapi deploys both arch-scan.py and rules/*.md"
else
  fail "setup --template python-fastapi did not deploy expected files"
  ls "$SETUP_TMP_PY/.devt/rules/" 2>&1 | head
fi
rm -rf "$SETUP_TMP_PY"

echo "== run-quality-gates.sh: parallel batch runs concurrently and reports failures =="
QG_TMP="$TMP/qg-test"
mkdir -p "$QG_TMP/.devt/rules"
# Use python3 with single-arg scripts (no `;` — those are blocked by the security
# validator). Build sleep helper + always-fail helper as standalone files.
cat > "$QG_TMP/qg_sleep.py" <<'EOF_QG'
import sys, time
time.sleep(float(sys.argv[1]))
print(sys.argv[2])
EOF_QG
cat > "$QG_TMP/qg_fail.py" <<'EOF_QG'
import sys
sys.exit(int(sys.argv[1]))
EOF_QG
cat > "$QG_TMP/.devt/rules/quality-gates.md" <<'EOF_QG'
# Test gates

```bash parallel
python3 qg_sleep.py 0.4 par1
```

```bash parallel
python3 qg_sleep.py 0.4 par2
```

```bash parallel
python3 qg_sleep.py 0.4 par3
```

```bash
python3 qg_fail.py 0
```
EOF_QG
QG_START=$(date +%s)
QG_OUT=$(cd "$QG_TMP" && bash "$ROOT/scripts/run-quality-gates.sh" 2>&1) || true
QG_END=$(date +%s)
QG_ELAPSED=$((QG_END - QG_START))
# 3 parallel sleeps of 0.4s + 1 sequential exit-0 = ~0.4s parallel, total <2s.
# Sequential would be 1.2s+. Allow up to 2s slop for CI.
if echo "$QG_OUT" | grep -q "Quality Gates: 4/4 passed" && [[ "$QG_ELAPSED" -le 2 ]]; then
  pass "parallel batch (3 gates) ran concurrently in ${QG_ELAPSED}s"
else
  fail "parallel runner regression — elapsed=${QG_ELAPSED}s, output below"
  echo "$QG_OUT"
fi

# Failure propagation in a parallel batch
cat > "$QG_TMP/.devt/rules/quality-gates.md" <<'EOF_QG'
# Test gates

```bash parallel
python3 qg_fail.py 0
```

```bash parallel
python3 qg_fail.py 1
```

```bash parallel
python3 qg_fail.py 0
```
EOF_QG
QG_FAIL_OUT=$(cd "$QG_TMP" && bash "$ROOT/scripts/run-quality-gates.sh" 2>&1) || QG_FAIL_EC=$?
if [[ "${QG_FAIL_EC:-0}" -ne 0 ]] && echo "$QG_FAIL_OUT" | grep -q "Quality Gates: 2/3 passed"; then
  pass "parallel batch surfaces 1 failure of 3"
else
  fail "parallel failure propagation regression"
  echo "$QG_FAIL_OUT"
fi

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
