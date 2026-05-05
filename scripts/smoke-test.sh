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

echo "== Memory layer (Phase 1, v0.16.0) =="
# Memory layer roundtrip in an isolated tmp project. NOTE: no subshell — `pass()`/`fail()`
# need to update the parent shell's PASS/FAIL counters. Use cd + trap-restored cwd.
MEMTMP=$(mktemp -d)
mkdir -p "$MEMTMP/.git" "$MEMTMP/.devt"
SAVED_CWD=$(pwd)
cd "$MEMTMP"
if node "$CLI" memory init >/dev/null 2>&1; then
  pass "memory init scaffolds .devt/memory/{decisions,concepts,flows,rejected}"
else
  fail "memory init failed"
fi

for sub in decisions concepts flows rejected; do
  if [ -d ".devt/memory/$sub" ]; then
    pass "memory init created .devt/memory/$sub/"
  else
    fail "memory init missed .devt/memory/$sub/"
  fi
done

# Drop a valid ADR + REJ + an auto-generated _suggestions.md that MUST be skipped.
cat > .devt/memory/decisions/ADR-001-test.md <<'ADR_EOF'
---
id: ADR-001
title: Argon2 password hashing
doc_type: decision
domain: security
status: active
confidence: explicit
summary: Use argon2 for password hashing for audit compliance
affects_paths:
  - src/auth/**
affects_symbols:
  - AuthService
created_at: 2026-05-05T10:00:00Z
created_by: user
---
# ADR-001
Body.
ADR_EOF

  cat > .devt/memory/rejected/REJ-001-redis.md <<'REJ_EOF'
---
id: REJ-001
title: Redis sessions
doc_type: rejected
domain: security
status: rejected
confidence: explicit
summary: Redis sessions rejected for compliance audit
reason: compliance
search_keywords:
  - Redis caching
  - in-memory session
---
# REJ-001
Body.
REJ_EOF

  echo "auto-generated, must not be indexed" > .devt/memory/decisions/_suggestions.md

  if node "$CLI" memory index >/dev/null 2>&1; then
    pass "memory index reindexes after adding fixtures"
  else
    fail "memory index failed"
  fi

  # Verify the _suggestions.md file was skipped — only 2 docs should be indexed
  IDX_COUNT=$(node "$CLI" memory list 2>/dev/null | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(d.docs.length)")
  if [ "$IDX_COUNT" = "2" ]; then
    pass "memory index skips _-prefixed files (auto-generated reports)"
  else
    fail "memory index indexed $IDX_COUNT docs (expected 2 — _suggestions.md should be skipped)"
  fi

  # FTS prefix matching: "argon" should hit "Argon2"
  FTS_HITS=$(node "$CLI" memory query argon 2>/dev/null | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(d.results.length)")
  if [ "$FTS_HITS" = "1" ]; then
    pass "memory query: prefix match (\"argon\" finds \"Argon2\")"
  else
    fail "memory query: expected 1 hit for \"argon\", got $FTS_HITS"
  fi

  # Glob-based affects matching
  AFFECTS_HITS=$(node "$CLI" memory affects src/auth/service.ts 2>/dev/null | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(d.matches.length)")
  if [ "$AFFECTS_HITS" = "1" ]; then
    pass "memory affects: glob src/auth/** matches src/auth/service.ts"
  else
    fail "memory affects: expected 1 match, got $AFFECTS_HITS"
  fi

  # REJ tombstone keywords
  REJ_KW=$(node "$CLI" memory rejected-keywords 2>/dev/null | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(d.entries.length)")
  if [ "$REJ_KW" = "2" ]; then
    pass "memory rejected-keywords: REJ-001 has 2 search_keywords for AI suppression"
  else
    fail "memory rejected-keywords: expected 2 entries, got $REJ_KW"
  fi

  # Validate clean fixture
  VALID_ERRORS=$(node "$CLI" memory validate 2>/dev/null | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(d.summary.errors)")
  if [ "$VALID_ERRORS" = "0" ]; then
    pass "memory validate: clean fixture produces 0 errors"
  else
    fail "memory validate: expected 0 errors, got $VALID_ERRORS"
  fi

  # Determinism: two index runs against unchanged state produce identical doc list
  RUN1=$(node "$CLI" memory list 2>/dev/null | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(JSON.stringify(d.docs.map(x=>x.id)))")
  node "$CLI" memory index >/dev/null 2>&1
  RUN2=$(node "$CLI" memory list 2>/dev/null | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(JSON.stringify(d.docs.map(x=>x.id)))")
  if [ "$RUN1" = "$RUN2" ]; then
    pass "memory index: deterministic (rebuild on same state produces same doc set)"
  else
    fail "memory index: non-deterministic ($RUN1 vs $RUN2)"
  fi

  # Frontmatter validation: missing required field is caught
  cat > .devt/memory/decisions/ADR-999-broken.md <<'BAD_EOF'
---
id: ADR-999
doc_type: decision
status: active
confidence: explicit
---
Missing title and summary.
BAD_EOF

BROKEN_ERRORS=$(node "$CLI" memory validate 2>/dev/null | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(d.summary.errors)")
if [ "$BROKEN_ERRORS" -ge "2" ]; then
  pass "memory validate: missing required fields produce errors (got $BROKEN_ERRORS)"
else
  fail "memory validate: expected ≥2 errors for missing title+summary, got $BROKEN_ERRORS"
fi

cd "$SAVED_CWD"
rm -rf "$MEMTMP"

echo "== Memory layer Phase 2 (v0.17.0) =="
# Phase 2 surfaces: graphify wrapper, discovery engine, new memory subcommands,
# memory-curation + graphify-helpers skills, memory-promote/memory-reject workflows.

# graphify.cjs degrades cleanly when disabled (default)
GRAPHIFY_STATE=$(node "$CLI" graphify status 2>/dev/null | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(d.state)")
if [ "$GRAPHIFY_STATE" = "disabled" ]; then
  pass "graphify.cjs reports state=disabled when graphify.enabled=false (default)"
else
  fail "graphify.cjs unexpected state: $GRAPHIFY_STATE"
fi

# graphify queryGraph returns grep-fallback payload when disabled
GRAPHIFY_QUERY_SOURCE=$(node "$CLI" graphify query "AuthService" 2>/dev/null | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(d.source)")
if [ "$GRAPHIFY_QUERY_SOURCE" = "grep" ]; then
  pass "graphify query returns source=grep with degraded=true when disabled"
else
  fail "graphify query expected source=grep, got $GRAPHIFY_QUERY_SOURCE"
fi

# graphify warm-cache returns null when graphify-out absent
WARM_CACHE=$(node "$CLI" graphify warm-cache 2>/dev/null | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(d.path)")
if [ "$WARM_CACHE" = "null" ]; then
  pass "graphify warm-cache returns null when no graphify-out/wiki/ or GRAPH_REPORT.md exists"
else
  fail "graphify warm-cache unexpected path: $WARM_CACHE"
fi

# discovery.cjs detects claude-mem availability
CLAUDEMEM_AVAIL=$(node "$CLI" discovery claude-mem-status 2>/dev/null | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(d.available)")
if [ "$CLAUDEMEM_AVAIL" = "true" ] || [ "$CLAUDEMEM_AVAIL" = "false" ]; then
  pass "discovery claude-mem-status returns boolean (available: $CLAUDEMEM_AVAIL)"
else
  fail "discovery claude-mem-status unexpected: $CLAUDEMEM_AVAIL"
fi

# Memory backlinks/orphans/stale-links/affects-symbol all wired
MEMTMP2=$(mktemp -d)
mkdir -p "$MEMTMP2/.git" "$MEMTMP2/.devt"
SAVED2=$(pwd)
cd "$MEMTMP2"
node "$CLI" memory init >/dev/null 2>&1

# Drop two ADRs with a link between them, plus an orphan
cat > .devt/memory/decisions/ADR-001-source.md <<'EOF1'
---
id: ADR-001
title: Source decision
doc_type: decision
domain: test
status: active
confidence: explicit
summary: Source ADR with depends_on link to ADR-002
links:
  - id: ADR-002
    type: depends_on
---
EOF1

cat > .devt/memory/decisions/ADR-002-target.md <<'EOF2'
---
id: ADR-002
title: Target decision
doc_type: decision
domain: test
status: active
confidence: explicit
summary: Target ADR — should appear in backlinks for ADR-001
---
EOF2

cat > .devt/memory/decisions/ADR-003-orphan.md <<'EOF3'
---
id: ADR-003
title: Orphan decision
doc_type: decision
domain: test
status: active
confidence: explicit
summary: ADR with no incoming or outgoing links
---
EOF3

# Add a stale link target
cat > .devt/memory/decisions/ADR-004-stale.md <<'EOF4'
---
id: ADR-004
title: Stale-link source
doc_type: decision
domain: test
status: active
confidence: explicit
summary: Points to a non-existent ADR
links:
  - id: ADR-999
    type: relates_to
---
EOF4

node "$CLI" memory index >/dev/null 2>&1

BACKLINKS=$(node "$CLI" memory backlinks ADR-002 2>/dev/null | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(d.backlinks.length)")
if [ "$BACKLINKS" = "1" ]; then
  pass "memory backlinks: ADR-002 has 1 incoming link from ADR-001"
else
  fail "memory backlinks: expected 1 backlink to ADR-002, got $BACKLINKS"
fi

ORPHANS=$(node "$CLI" memory orphans 2>/dev/null | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(d.orphans.length)")
if [ "$ORPHANS" = "1" ]; then
  pass "memory orphans: ADR-003 surfaces as the only orphan (no in/out links)"
else
  fail "memory orphans: expected 1 orphan, got $ORPHANS"
fi

STALE=$(node "$CLI" memory stale-links 2>/dev/null | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(d.stale.length)")
if [ "$STALE" = "1" ]; then
  pass "memory stale-links: ADR-004 → ADR-999 surfaces as stale (target doesn't exist)"
else
  fail "memory stale-links: expected 1 stale link, got $STALE"
fi

AFFECTS_SYM_DEGRADED=$(node "$CLI" memory affects-symbol AuthService 2>/dev/null | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(d.degraded)")
if [ "$AFFECTS_SYM_DEGRADED" = "true" ]; then
  pass "memory affects-symbol: degraded=true when graphify disabled"
else
  fail "memory affects-symbol: expected degraded=true, got $AFFECTS_SYM_DEGRADED"
fi

cd "$SAVED2"
rm -rf "$MEMTMP2"

# Phase 2 file presence (use $ROOT — script's cwd is the smoke-test tmp dir)
[ -f "$ROOT/bin/modules/graphify.cjs" ] && pass "bin/modules/graphify.cjs exists" || fail "bin/modules/graphify.cjs missing"
[ -f "$ROOT/bin/modules/discovery.cjs" ] && pass "bin/modules/discovery.cjs exists" || fail "bin/modules/discovery.cjs missing"
[ -f "$ROOT/skills/memory-curation/SKILL.md" ] && pass "skills/memory-curation/SKILL.md exists" || fail "skills/memory-curation/SKILL.md missing"
[ -f "$ROOT/skills/graphify-helpers/SKILL.md" ] && pass "skills/graphify-helpers/SKILL.md exists" || fail "skills/graphify-helpers/SKILL.md missing"
[ -f "$ROOT/workflows/memory-promote.md" ] && pass "workflows/memory-promote.md exists" || fail "workflows/memory-promote.md missing"
[ -f "$ROOT/workflows/memory-reject.md" ] && pass "workflows/memory-reject.md exists" || fail "workflows/memory-reject.md missing"

# Curator agent has memory-curation skill preloaded
if grep -q "devt:memory-curation" "$ROOT/agents/curator.md"; then
  pass "agents/curator.md preloads devt:memory-curation skill"
else
  fail "agents/curator.md missing memory-curation skill preload"
fi

# Existing skills got the memory + graphify integration sections
for skill in codebase-scan code-review-guide lesson-extraction playbook-curation architecture-health-scanner autoskill strategic-analysis tdd-patterns verification-patterns complexity-assessment semantic-search; do
  if grep -q "Memory + Graphify integration\|Memory layer integration\|REJ tombstone consultation\|Sister skill: memory-curation" "$ROOT/skills/$skill/SKILL.md" 2>/dev/null; then
    pass "skills/$skill/SKILL.md has Phase 2 integration section"
  else
    fail "skills/$skill/SKILL.md missing Phase 2 integration"
  fi
done

# Existing workflows got memory layer integration sections
for wf in clarify-task specify research-task lesson-extraction debug code-review autoskill arch-health-scan; do
  if grep -q "Memory layer integration\|REJ tombstone consultation\|Stale ADR detection" "$ROOT/workflows/$wf.md" 2>/dev/null; then
    pass "workflows/$wf.md has Phase 2 memory integration section"
  else
    fail "workflows/$wf.md missing Phase 2 integration"
  fi
done

echo "== Council structured-output contract =="
# Council advisor template must enforce Options + Validated Reasoning structure.
# Free-form advisor output is the regression this guards against.
if grep -q "## Validated Reasoning" "$ROOT/skills/council/SKILL.md" \
   && grep -q "## Options Considered" "$ROOT/skills/council/SKILL.md" \
   && grep -q "Evidence:" "$ROOT/skills/council/SKILL.md"; then
  pass "council SKILL.md enforces structured advisor output (Options + Validated Reasoning + Evidence citations)"
else
  fail "council SKILL.md missing structured-output contract — advisors will return free-form prose"
fi

echo "== Council offramp wired into clarify/research/specify =="
# Path 1 integration: each of the three brainstorming workflows must reference
# the offramp helper. Locks the integration so a future workflow edit can't
# silently drop the council option.
OFFRAMP_REF="references/council-offramp.md"
if [ -f "$ROOT/$OFFRAMP_REF" ]; then
  pass "$OFFRAMP_REF exists"
else
  fail "$OFFRAMP_REF missing — Path 1 integration broken"
fi
for wf in clarify-task.md research-task.md specify.md; do
  if grep -q "council-offramp.md" "$ROOT/workflows/$wf"; then
    pass "workflows/$wf references council-offramp.md"
  else
    fail "workflows/$wf does not reference council-offramp.md"
  fi
done
if grep -q "/devt:council" "$ROOT/workflows/specify.md"; then
  pass "workflows/specify.md Step 6 next-steps list includes /devt:council option"
else
  fail "workflows/specify.md Step 6 missing /devt:council option"
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
