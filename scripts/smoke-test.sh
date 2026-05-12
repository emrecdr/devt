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

# pass_if_file <path> <label> — the most common Phase 3+ assertion shape.
pass_if_file() {
  if [ -f "$1" ]; then pass "$2"; else fail "$2 (missing: $1)"; fi
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
run_json "report window"   node "$CLI" report window

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
  pass "memory init scaffolds .devt/memory/{decisions,concepts,flows,rejected,lessons}"
else
  fail "memory init failed"
fi

for sub in decisions concepts flows rejected lessons; do
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

echo "== Shared utilities (security.cjs, io.cjs, graphify.cjs::probeBinary) =="

# config get accepts dot-notation path arg; bare config get still returns full config.
GET_PATH=$(node "$CLI" config get model_profile 2>/dev/null | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(d.found===true && typeof d.value==='string')")
[ "$GET_PATH" = "true" ] && pass "config get supports dot-notation path arg" || fail "config get dot-notation broken (got: $GET_PATH)"

# config get rejects __proto__-style traversal (CLI exits non-zero on rejection — swallow it)
PROTO_REJECT=$( { node "$CLI" config get __proto__.constructor 2>&1 || true; } | node -e "
let d; try { d = JSON.parse(require('fs').readFileSync(0,'utf8')); } catch { console.log('false'); process.exit(0); }
console.log(typeof d.error==='string' && d.error.includes('Forbidden'))
" 2>/dev/null)
[ "$PROTO_REJECT" = "true" ] && pass "config get blocks prototype-chain traversal" || fail "config get __proto__ NOT blocked (got: $PROTO_REJECT)"

# maskSecrets masks secret-shaped keys, leaves non-secret keys alone, and survives cycles.
MASK_OK=$(node -e "
const sec = require('${ROOT}/bin/modules/security.cjs');
const out = sec.maskSecrets({ api_key: 'leak', auth_strategy: 'jwt', nested: { token: 'x' } });
const cycle = { name: 'a' }; cycle.self = cycle;
const cy = sec.maskSecrets(cycle);
console.log(out.api_key==='***MASKED***' && out.auth_strategy==='jwt' && out.nested.token==='***MASKED***' && cy.self==='[Circular]')
")
[ "$MASK_OK" = "true" ] && pass "maskSecrets masks secrets, spares non-secrets, handles cycles" || fail "maskSecrets misbehaving (got: $MASK_OK)"

# graphify.probeBinary callable, returns boolean
PROBE_TYPE=$(node -e "console.log(typeof require('${ROOT}/bin/modules/graphify.cjs').probeBinary())")
[ "$PROBE_TYPE" = "boolean" ] && pass "graphify.probeBinary returns boolean" || fail "graphify.probeBinary broken (got: $PROBE_TYPE)"

echo "== Memory layer Phase 2 (v0.17.0) =="
# Phase 2 surfaces: graphify wrapper, discovery engine, new memory subcommands,
# memory-curation + graphify-helpers skills, memory-promote/memory-reject workflows.

# graphify.cjs degrades cleanly when disabled. Force-disable here in case the
# host machine has graphify on PATH — setup.cjs auto-enables in that case, so
# we explicitly opt out for these disabled-mode assertions.
node "$CLI" config set graphify.enabled=false >/dev/null 2>&1
GRAPHIFY_STATE=$(node "$CLI" graphify status 2>/dev/null | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(d.state)")
if [ "$GRAPHIFY_STATE" = "disabled" ]; then
  pass "graphify.cjs reports state=disabled when graphify.enabled=false"
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

# LES-NNNN doc_type=lesson acceptance (v0.28.0+) — schema accepts lessons as a 5th memory shape.
# Validates: id pattern, doc_type=lesson, indexable, FTS5-queryable.
cat > .devt/memory/lessons/LES-001-test.md <<'EOF_LES'
---
id: LES-001
title: "Concurrent map writes panic"
doc_type: lesson
domain: backend
status: active
confidence: explicit
summary: "Concurrent goroutine writes to in-memory map cache panic without sync.RWMutex."
affects_paths:
  - "internal/cache/store.go"
links: []
created_at: "2026-05-06T13:00:00Z"
created_by: retro
---

## Trigger
High-throughput tests with 50+ concurrent writers.

## Action
Wrap map access with sync.RWMutex.
EOF_LES

LES_INDEX=$(node "$CLI" memory index 2>/dev/null | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(d.errors.filter(e=>e.filePath&&e.filePath.includes('LES-001')).length)")
if [ "$LES_INDEX" = "0" ]; then
  pass "memory index accepts LES-NNNN doc_type=lesson without schema errors"
else
  fail "memory index rejected LES-001 with $LES_INDEX errors"
fi

LES_QUERY=$(node "$CLI" memory query "concurrent" 2>/dev/null | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));const r=d.results.find(x=>x.id==='LES-001');console.log(r&&r.doc_type==='lesson'?'yes':'no')")
if [ "$LES_QUERY" = "yes" ]; then
  pass "memory query: lesson surfaces via unified FTS5 (closes playbook isolation gap)"
else
  fail "memory query: LES-001 did not surface for 'concurrent' query"
fi

# v0.28.0 — memory query --doc-type=<type> filter restricts results to that type.
# Project has ADR-001..004 + LES-001; filtering by lesson must exclude ADRs.
LES_FILTER_OK=$(node "$CLI" memory query "source" --doc-type=lesson 2>/dev/null | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));const types=new Set(d.results.map(r=>r.doc_type));console.log(types.size===0||(types.size===1&&types.has('lesson'))?'yes':'no')")
if [ "$LES_FILTER_OK" = "yes" ]; then
  pass "memory query --doc-type=lesson restricts results to lesson docs"
else
  fail "memory query --doc-type=lesson leaked non-lesson docs"
fi

LES_FILTER_REJECT=$(node "$CLI" memory query "x" --doc-type=bogus 2>&1 | head -1 || true)
if echo "$LES_FILTER_REJECT" | grep -q "Invalid --doc-type"; then
  pass "memory query --doc-type rejects invalid values"
else
  fail "memory query --doc-type accepted invalid value: $LES_FILTER_REJECT"
fi

cd "$SAVED2"
rm -rf "$MEMTMP2"

# v0.29.0 — Deferred-task tracker (.devt/state/deferred.md, DEF-NNN, reset-exempt).
echo "== Deferred-task tracker (v0.29.0) =="
DEFTMP=$(mktemp -d)
mkdir -p "$DEFTMP/.git"
SAVED_DEF=$(pwd)
cd "$DEFTMP"

# Add: assigns DEF-NNN sequentially
DEF1_OUT=$(node "$CLI" deferred add "First deferred item" --tags=security,api --by=user 2>/dev/null)
DEF1_ID=$(echo "$DEF1_OUT" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).id)")
DEF2_OUT=$(node "$CLI" deferred add "Second deferred item" --tags=refactor 2>/dev/null)
DEF2_ID=$(echo "$DEF2_OUT" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).id)")
if [[ "$DEF1_ID" == "DEF-001" && "$DEF2_ID" == "DEF-002" ]]; then
  pass "deferred add: assigns DEF-NNN ids sequentially (DEF-001, DEF-002)"
else
  fail "deferred add: expected DEF-001/DEF-002, got $DEF1_ID/$DEF2_ID"
fi

# List: returns both items
DEF_LIST_COUNT=$(node "$CLI" deferred list 2>/dev/null | node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync(0,'utf8')).length))")
if [[ "$DEF_LIST_COUNT" == "2" ]]; then
  pass "deferred list: returns 2 items"
else
  fail "deferred list: expected 2 items, got $DEF_LIST_COUNT"
fi

# Close: flips status, sets closed_at + closed_by
DEF_CLOSE_OUT=$(node "$CLI" deferred close DEF-001 --by=programmer 2>/dev/null)
DEF_CLOSE_OK=$(echo "$DEF_CLOSE_OUT" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(d.status==='closed'&&!!d.closed_at&&!!d.closed_by?'yes':'no')")
if [[ "$DEF_CLOSE_OK" == "yes" ]]; then
  pass "deferred close: status=closed, closed_at + closed_by set"
else
  fail "deferred close: expected closed status with metadata, got $DEF_CLOSE_OUT"
fi

# Count: open=1, closed=1, total=2
DEF_COUNT=$(node "$CLI" deferred count 2>/dev/null | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(d.open+'/'+d.closed+'/'+d.total)")
if [[ "$DEF_COUNT" == "1/1/2" ]]; then
  pass "deferred count: {open:1, closed:1, total:2}"
else
  fail "deferred count: expected 1/1/2, got $DEF_COUNT"
fi

# Reset exemption: state reset must NOT wipe deferred.md
node "$CLI" state update phase=test >/dev/null 2>&1
node "$CLI" state reset >/dev/null 2>&1
if [ -f .devt/state/deferred.md ] && grep -q "DEF-001" .devt/state/deferred.md; then
  pass "state reset preserves deferred.md (DEF-001 still present after reset)"
else
  fail "state reset wiped deferred.md or its contents"
fi

# v0.30.4 — state reset archives non-exempt artifacts to .devt/state/.archive/<ts>/
echo "scratch" > .devt/state/scratchpad.md
RESET_OUT=$(node "$CLI" state reset 2>/dev/null)
ARCHIVED_TO=$(echo "$RESET_OUT" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{process.stdout.write(JSON.parse(d).archived_to||'')}catch{}});")
if [ -n "$ARCHIVED_TO" ] && [ -f "$ARCHIVED_TO/scratchpad.md" ] && [ ! -f .devt/state/scratchpad.md ]; then
  pass "state reset archives non-exempt artifacts to .archive/<ts>/"
else
  fail "state reset did not archive properly (archived_to=$ARCHIVED_TO)"
fi

# v0.30.4 — workflow_type alias hint guides agents away from common hallucinations
WT_HINT_OUT=$(node "$CLI" state update workflow_type=workflow 2>&1 | head -1)
if echo "$WT_HINT_OUT" | grep -q 'Did you mean .*dev' && echo "$WT_HINT_OUT" | grep -q 'Valid:'; then
  pass "workflow_type alias hint: 'workflow' suggests 'dev' + lists valid values"
else
  fail "workflow_type alias hint missing for 'workflow' input: $WT_HINT_OUT"
fi

# v0.30.4 — state read-section returns sliced content with match mode
cat > .devt/state/plan.md <<'PLAN_EOF'
# Plan
## Phase 1: Setup
Setup body.
## Phase 2: Build
Build body.
PLAN_EOF
SECTION_OUT=$(node "$CLI" state read-section --file plan.md --section "Phase 2" 2>/dev/null)
if echo "$SECTION_OUT" | grep -q '"match":"prefix"' && echo "$SECTION_OUT" | grep -q "Build body"; then
  pass "state read-section: prefix match returns sliced section"
else
  fail "state read-section: expected prefix match with 'Build body', got: $SECTION_OUT"
fi
SECTION_MISS=$(node "$CLI" state read-section --file plan.md --section "NoSuchSection" 2>/dev/null)
if echo "$SECTION_MISS" | grep -q '"ok":false' && echo "$SECTION_MISS" | grep -q "section not found"; then
  pass "state read-section: missing section returns ok:false"
else
  fail "state read-section: missing section did not return expected error: $SECTION_MISS"
fi

# v0.30.5 — pre-flight-guard hook appends every deny to .devt/state/preflight-denies.log
echo '{"memory":{"preflight_mode":"block","enabled":true}}' > .devt/config.json
echo "active: true" > .devt/state/workflow.yaml
rm -f .devt/state/scratchpad.md .devt/state/preflight-denies.log
HOOK_OUT=$(echo '{"tool_name":"Edit","tool_input":{"file_path":"/tmp/smoke-target.py"}}' | bash "$ROOT/hooks/pre-flight-guard.sh" 2>/dev/null)
if [ -f .devt/state/preflight-denies.log ] && grep -q "block .* edit /tmp/smoke-target.py :: missing PREFLIGHT line" .devt/state/preflight-denies.log; then
  pass "pre-flight-guard: deny appended to preflight-denies.log"
else
  fail "pre-flight-guard: deny log missing or malformed (content: $(cat .devt/state/preflight-denies.log 2>/dev/null))"
fi
# Verify the deny JSON itself is unchanged (forensic logging must not break the hook contract)
if echo "$HOOK_OUT" | grep -q '"decision":"deny"'; then
  pass "pre-flight-guard: deny JSON contract still emitted alongside log"
else
  fail "pre-flight-guard: deny JSON missing — hook contract broken: $HOOK_OUT"
fi
# Cleanup placeholder so subsequent assertions have a clean state dir
rm -f .devt/state/preflight-denies.log .devt/state/workflow.yaml .devt/config.json

# Invalid id rejected with exit 2
DEF_INVALID_OUT=$(node "$CLI" deferred get FOO-001 2>&1 || true)
if echo "$DEF_INVALID_OUT" | grep -q "invalid id"; then
  pass "deferred get rejects invalid DEF-NNN ids"
else
  fail "deferred get accepted invalid id: $DEF_INVALID_OUT"
fi

cd "$SAVED_DEF"
rm -rf "$DEFTMP"

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
for skill in codebase-scan code-review-guide lesson-extraction architecture-health-scanner autoskill strategic-analysis tdd-patterns verification-patterns complexity-assessment; do
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

echo "== Phase 3 (v0.18.0): preflight + MCP server + hooks =="
# Preflight module CLI
run_json "preflight topic" node "$CLI" preflight topic "Add MFA to AuthService"
run_json "preflight status (no brief yet)" node "$CLI" preflight status

# Generate a real brief (in temp dir from earlier — memory is initialized + indexed)
if node "$CLI" preflight generate "Refactor AuthService to use Argon2" >/dev/null 2>&1; then
  pass "preflight generate writes brief"
else
  fail "preflight generate failed"
fi
if [ -f .devt/state/preflight-brief.md ]; then
  pass "preflight-brief.md created"
  if grep -q "^## Status: FRESH" .devt/state/preflight-brief.md; then
    pass "preflight brief has FRESH status line"
  else
    fail "preflight brief missing FRESH status line"
  fi
else
  fail "preflight-brief.md not created"
fi

# Determinism: two consecutive runs produce byte-identical bodies modulo timestamp + lane order
node "$CLI" preflight generate "test deterministic" >/dev/null 2>&1
B1=$(grep -v "^Generated " .devt/state/preflight-brief.md | sha256sum | cut -d' ' -f1)
node "$CLI" preflight generate "test deterministic" >/dev/null 2>&1
B2=$(grep -v "^Generated " .devt/state/preflight-brief.md | sha256sum | cut -d' ' -f1)
if [ "$B1" = "$B2" ]; then
  pass "preflight is deterministic (timestamps stripped)"
else
  fail "preflight is non-deterministic — B1=$B1 B2=$B2"
fi

# Mark stale
node "$CLI" preflight mark-stale "smoke test" >/dev/null 2>&1
if grep -q "^## Status: STALE" .devt/state/preflight-brief.md; then
  pass "preflight mark-stale flips Status to STALE"
else
  fail "preflight mark-stale did not flip status"
fi

# MCP server SELECT-only validator self-test
if node "$ROOT/bin/devt-memory-mcp.cjs" --self-test >/dev/null 2>&1; then
  pass "devt-memory-mcp SELECT-only validator (15/15)"
else
  fail "devt-memory-mcp SELECT-only validator failed"
fi

# MCP server stdio: initialize + tools/list
MCP_OUT=$(printf '%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | timeout 3 node "$ROOT/bin/devt-memory-mcp.cjs" 2>/dev/null)
if echo "$MCP_OUT" | grep -q '"serverInfo":{"name":"devt-memory-mcp"'; then
  pass "MCP initialize handshake"
else
  fail "MCP initialize handshake — got: $(echo "$MCP_OUT" | head -1)"
fi
if echo "$MCP_OUT" | grep -q '"name":"query_index"'; then
  pass "MCP tools/list exposes query_index"
else
  fail "MCP tools/list missing query_index"
fi

# MCP query_index rejects DROP
DROP_REPLY=$(printf '%s\n%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"query_index","arguments":{"sql":"DROP TABLE documents"}}}' \
  '{"jsonrpc":"2.0","id":3,"method":"shutdown"}' \
  | timeout 3 node "$ROOT/bin/devt-memory-mcp.cjs" 2>/dev/null)
if echo "$DROP_REPLY" | grep -q "forbidden token: DROP"; then
  pass "MCP query_index rejects DROP"
else
  fail "MCP query_index DID NOT reject DROP — DANGER"
fi

# pre-flight-guard hook: warn mode in active workflow without scratchpad → emits advisory
echo "active: true" > .devt/state/workflow.yaml
PG_OUT=$(echo '{"tool_input":{"file_path":"src/auth/service.ts"}}' | bash "$ROOT/hooks/pre-flight-guard.sh" 2>/dev/null)
if echo "$PG_OUT" | grep -q "Pre-Flight"; then
  pass "pre-flight-guard hook emits advisory in warn mode"
else
  fail "pre-flight-guard hook did not emit advisory — got: $PG_OUT"
fi

# pre-flight-guard hook: covered scratchpad line → silent pass-through
echo "PREFLIGHT 2026-05-05T15:30Z edit src/auth/service.ts :: ADR-007" > .devt/state/scratchpad.md
PG_COV=$(echo '{"tool_input":{"file_path":"src/auth/service.ts"}}' | bash "$ROOT/hooks/pre-flight-guard.sh" 2>/dev/null)
if [ -z "$PG_COV" ]; then
  pass "pre-flight-guard silent when scratchpad covers file"
else
  fail "pre-flight-guard not silent when covered — got: $PG_COV"
fi
rm -f .devt/state/scratchpad.md .devt/state/workflow.yaml

# Project .mcp.json must NOT contain devt-memory — that server lives in the plugin-root .mcp.json
# (resolved by Claude Code via ${CLAUDE_PLUGIN_ROOT} when devt is loaded as a plugin). Project-level
# .mcp.json is reserved for project-relative servers (graphify, claude-mem) only — and is
# only created when at least one of those probes succeeds. Both states are valid; both must
# uphold the "no devt-memory in project scope" invariant, so the assertion always fires.
if [ -f .mcp.json ]; then
  if grep -q "devt-memory" .mcp.json; then
    fail "project .mcp.json must not contain devt-memory (it ships in the plugin-root .mcp.json)"
  else
    pass "project .mcp.json correctly omits devt-memory"
  fi
else
  pass "project .mcp.json correctly absent (no project-relative MCP servers detected)"
fi
# Plugin-root .mcp.json must register devt-memory with the ${CLAUDE_PLUGIN_ROOT} path template
if [ -f "$ROOT/.mcp.json" ] && grep -q '"devt-memory"' "$ROOT/.mcp.json" && grep -q '${CLAUDE_PLUGIN_ROOT}/bin/devt-memory-mcp.cjs' "$ROOT/.mcp.json"; then
  pass "plugin-root .mcp.json registers devt-memory via \${CLAUDE_PLUGIN_ROOT}"
else
  fail "plugin-root .mcp.json missing or malformed devt-memory entry"
fi

# Gitignore additions for Graphify + claude-mem
if grep -q "graphify-out/cache/" .gitignore && grep -q ".claude-mem/mem.db" .gitignore; then
  pass "gitignore manifest extended (graphify-out/cache, claude-mem/mem.db)"
else
  fail "gitignore manifest incomplete"
fi

# Skill + hook + workflow files exist
pass_if_file "$ROOT/skills/memory-pre-flight/SKILL.md" "skills/memory-pre-flight/SKILL.md exists"
pass_if_file "$ROOT/hooks/pre-flight-guard.sh"        "hooks/pre-flight-guard.sh exists"
pass_if_file "$ROOT/hooks/memory-auto-index.sh"       "hooks/memory-auto-index.sh exists"
pass_if_file "$ROOT/commands/preflight.md"            "commands/preflight.md exists"
pass_if_file "$ROOT/workflows/preflight.md"           "workflows/preflight.md exists"
pass_if_file "$ROOT/bin/modules/preflight.cjs"        "bin/modules/preflight.cjs exists"
pass_if_file "$ROOT/bin/devt-memory-mcp.cjs"          "bin/devt-memory-mcp.cjs exists"
pass_if_file "$ROOT/commands/uninstall.md"            "commands/uninstall.md exists"
pass_if_file "$ROOT/workflows/uninstall.md"           "workflows/uninstall.md exists"

# Auto-fire integration: every dev workflow calls preflight
for wf in dev-workflow.md quick-implement.md create-plan.md clarify-task.md specify.md research-task.md debug.md code-review.md; do
  if grep -q "preflight generate" "$ROOT/workflows/$wf"; then
    pass "workflows/$wf auto-fires preflight"
  else
    fail "workflows/$wf does not auto-fire preflight"
  fi
done

# All 8 development agents preload memory-pre-flight skill
for ag in programmer architect code-reviewer debugger researcher tester verifier docs-writer; do
  if grep -q "devt:memory-pre-flight" "$ROOT/agents/$ag.md"; then
    pass "agents/$ag.md preloads devt:memory-pre-flight"
  else
    fail "agents/$ag.md missing devt:memory-pre-flight skill preload"
  fi
done

# Golden rules: R14 + R15 added
if grep -q "Rule 14: Pre-Flight Protocol" "$ROOT/guardrails/golden-rules.md"; then
  pass "golden-rules.md Rule 14 (Pre-Flight Protocol) present"
else
  fail "golden-rules.md missing Rule 14"
fi
if grep -q "Rule 15: Memory Maintenance" "$ROOT/guardrails/golden-rules.md"; then
  pass "golden-rules.md Rule 15 (Memory Maintenance) present"
else
  fail "golden-rules.md missing Rule 15"
fi

# State has preflight workflow_type registered
if grep -q '"preflight"' "$ROOT/bin/modules/state.cjs"; then
  pass "state.cjs registers preflight workflow_type"
else
  fail "state.cjs missing preflight workflow_type"
fi

echo "== Phase 4 (v0.19.0): block-mode flip + wide-surface polish =="
# Default preflight_mode flipped to block
DEFAULT_MODE=$(node -e "console.log(require('$ROOT/bin/modules/config.cjs').DEFAULTS.memory.preflight_mode)")
if [ "$DEFAULT_MODE" = "block" ]; then
  pass "memory.preflight_mode default is 'block' (Phase 4)"
else
  fail "memory.preflight_mode default is '$DEFAULT_MODE' (expected 'block')"
fi

# docs/MEMORY.md exists with required sections
pass_if_file "$ROOT/docs/MEMORY.md" "docs/MEMORY.md exists"
if [ -f "$ROOT/docs/MEMORY.md" ]; then
  for section in "Two Layers" "Two-Tier Pre-Flight" "MCP Server" "Curator Promotion" "Memory Maintenance"; do
    if grep -q "$section" "$ROOT/docs/MEMORY.md"; then
      pass "docs/MEMORY.md has '$section' section"
    else
      fail "docs/MEMORY.md missing '$section' section"
    fi
  done
fi

# v0.29.0+ — questioning-guide gained codebase-first, decision-tree, and one-at-a-time sections.
# Lightweight presence check; protects against accidental deletion during future edits.
if [ -f "$ROOT/references/questioning-guide.md" ]; then
  for section in "Before You Ask" "Walk the Decision Tree" "One at a Time"; do
    if grep -q "$section" "$ROOT/references/questioning-guide.md"; then
      pass "questioning-guide.md has '$section' section"
    else
      fail "questioning-guide.md missing '$section' section"
    fi
  done
fi

# README has Memory Layer section (under Features in v0.29.0+ structure)
# primary_branch detection surfaces detection_source field (v0.30.0+)
if grep -q "primary_branch_source\|primary_branch_low_confidence" "$ROOT/bin/modules/setup.cjs"; then
  pass "setup.cjs primary_branch detection emits source + low_confidence fields"
else
  fail "setup.cjs missing primary_branch detection chain output fields"
fi

if grep -q "primary_branch_low_confidence" "$ROOT/workflows/project-init.md"; then
  pass "project-init.md escalates primary_branch when detection is low-confidence"
else
  fail "project-init.md missing primary_branch low-confidence escalation"
fi

if grep -q "memory layer" "$ROOT/README.md"; then
  pass "README.md has 'The Memory Layer' section"
else
  fail "README.md missing Memory Layer section"
fi

# All 5 templates have Pre-Flight Protocol section
for tpl in blank go python-fastapi typescript-node vue-bootstrap; do
  if grep -q "Pre-Flight Protocol" "$ROOT/templates/$tpl/golden-rules.md"; then
    pass "templates/$tpl/golden-rules.md has Pre-Flight Protocol section"
  else
    fail "templates/$tpl/golden-rules.md missing Pre-Flight Protocol section"
  fi
done

# cancel-workflow.sh removes preflight-brief.md
if grep -q "preflight-brief.md" "$ROOT/scripts/cancel-workflow.sh"; then
  pass "cancel-workflow.sh cleans preflight-brief.md"
else
  fail "cancel-workflow.sh does not clean preflight-brief.md"
fi

# Workflow polish
for wf_pair in "status.md:Pre-Flight Brief" "ship.md:preflight-brief.md" "pause-work.md:Pre-Flight Brief" "health.md:MEM_VALIDATE_ERRORS"; do
  wf="${wf_pair%%:*}"
  needle="${wf_pair##*:}"
  if grep -q "$needle" "$ROOT/workflows/$wf"; then
    pass "workflows/$wf integrates Pre-Flight Brief"
  else
    fail "workflows/$wf missing Pre-Flight Brief integration ($needle)"
  fi
done

# pre-flight-guard hook in block mode actually denies (cwd is the smoke temp project)
mkdir -p .devt/state
echo "active: true" > .devt/state/workflow.yaml
echo '{"memory":{"preflight_mode":"block"}}' > .devt/config.json
BLK=$(echo '{"tool_input":{"file_path":"src/auth/service.ts"}}' | bash "$ROOT/hooks/pre-flight-guard.sh" 2>/dev/null)
if echo "$BLK" | grep -q '"decision":"deny"'; then
  pass "pre-flight-guard returns deny in block mode"
else
  fail "pre-flight-guard did not deny in block mode (got: $BLK)"
fi
# cleanup so other tests don't see block-mode config
rm -f .devt/config.json .devt/state/workflow.yaml

echo "== Phase 5 (v0.20.0): topic tuning + token-report + portable bundles + post-commit + weekly memory =="
# Topic extraction filters action verbs from symbols
TOPIC_OUT=$(node "$CLI" preflight topic "Add MFA support to AuthService for the user login flow" 2>/dev/null)
if echo "$TOPIC_OUT" | grep -q '"AuthService"' && ! echo "$TOPIC_OUT" | grep -q '"Add"'; then
  pass "topic extraction filters 'Add' from symbols, keeps 'AuthService'"
else
  fail "topic extraction did not filter 'Add' (got: $TOPIC_OUT)"
fi

# token-report runs and emits required fields (or graceful "no logs" message)
TR_OUT=$(node "$CLI" token-report --sessions=2 2>/dev/null)
if echo "$TR_OUT" | grep -q '"aggregate"' || echo "$TR_OUT" | grep -q "no Claude Code session logs"; then
  pass "token-report emits aggregate (or graceful no-logs payload)"
else
  fail "token-report missing required fields"
fi

# token-report rejects path traversal in --project
TR_BAD=$(node "$CLI" token-report --project=../../../etc 2>&1 || true)
if echo "$TR_BAD" | grep -qiE "absolute|invalid|traversal"; then
  pass "token-report rejects relative --project path"
else
  fail "token-report did not reject relative --project (got: $TR_BAD)"
fi

# memory export/import round-trip
node "$CLI" memory init >/dev/null 2>&1 || true
node "$CLI" memory index >/dev/null 2>&1 || true
EXP=$(node "$CLI" memory export --out=test-bundle.json 2>/dev/null)
if echo "$EXP" | grep -q '"exported_to"' && [ -f test-bundle.json ]; then
  pass "memory export writes bundle"
else
  fail "memory export failed (got: $EXP)"
fi

# Bundle is well-formed JSON with schema_version + docs array
if node -e "const b=JSON.parse(require('fs').readFileSync('test-bundle.json','utf8')); process.exit((b.schema_version===1 && Array.isArray(b.docs)) ? 0 : 1)"; then
  pass "bundle JSON has schema_version=1 and docs array"
else
  fail "bundle JSON malformed"
fi

# Import in a separate tmp dir with prefix — capture output, run assertions in parent shell
# so pass/fail counters increment correctly.
TIMP=$(mktemp -d)
cp test-bundle.json "$TIMP/"
(cd "$TIMP" && node "$CLI" setup --template blank --mode create >/dev/null 2>&1)
IMP=$(cd "$TIMP" && node "$CLI" memory import test-bundle.json --prefix=SMOKE- 2>/dev/null)
if echo "$IMP" | grep -q "SMOKE-"; then
  pass "memory import accepts --prefix=SMOKE- (id remapped)"
else
  fail "memory import --prefix did not apply"
fi
IMP2=$(cd "$TIMP" && node "$CLI" memory import test-bundle.json --prefix=SMOKE- 2>/dev/null)
if echo "$IMP2" | grep -q '"skipped"' && echo "$IMP2" | grep -qE '"created":\s*0'; then
  pass "memory import skips when id exists (no --overwrite)"
else
  fail "memory import did not skip"
fi
IMP3=$(cd "$TIMP" && node "$CLI" memory import test-bundle.json --prefix=lowercase 2>&1 || true)
if echo "$IMP3" | grep -qi "prefix must match"; then
  pass "memory import rejects invalid --prefix"
else
  fail "memory import did not reject invalid prefix"
fi
rm -rf "$TIMP"

# post-commit-validate.sh exists + executable
[ -x "$ROOT/hooks/post-commit-validate.sh" ] \
  && pass "hooks/post-commit-validate.sh exists and is executable" \
  || fail "hooks/post-commit-validate.sh missing or not executable"

# setup.cjs scaffolds .git/hooks/post-commit. Behavior is environment-dependent:
#  - Graphify NOT on PATH → devt installs its own wrapper (validates memory layer)
#  - Graphify ON PATH      → devt yields ownership (graphify hook install supersedes;
#                            documented in setup.cjs:383). Hook absence is correct.
TGIT=$(mktemp -d)
(cd "$TGIT" && git init -q && node "$CLI" setup --template blank --mode create >/dev/null 2>&1)
if command -v graphify >/dev/null 2>&1; then
  # Graphify on PATH — devt's hook MUST be skipped (Graphify supersedes)
  if [ -e "$TGIT/.git/hooks/post-commit" ]; then
    fail "setup.cjs installed devt post-commit when Graphify on PATH (Graphify supersedes — devt hook should be absent)"
  else
    pass "setup.cjs yields post-commit ownership to Graphify when Graphify is on PATH"
  fi
else
  # Graphify absent — devt's wrapper must be installed and delegate to plugin script
  if [ -x "$TGIT/.git/hooks/post-commit" ]; then
    pass "setup.cjs installs .git/hooks/post-commit when Graphify absent"
  else
    fail ".git/hooks/post-commit not installed"
  fi
  if grep -q "post-commit-validate.sh" "$TGIT/.git/hooks/post-commit" 2>/dev/null; then
    pass "post-commit wrapper delegates to plugin script"
  else
    fail "post-commit wrapper does not delegate"
  fi
fi
rm -rf "$TGIT"

# weekly-report includes memory_events field
WR_OUT=$(node "$CLI" report generate --weeks 1 2>/dev/null)
if echo "$WR_OUT" | grep -q '"memory_events"'; then
  pass "weekly-report includes memory_events aggregation"
else
  fail "weekly-report missing memory_events field"
fi

# Templates have ADR override notes in 4 ancillary files (search for any memory marker:
# .devt/memory path OR ADR mention OR `memory` CLI invocation)
for tpl in blank go python-fastapi typescript-node vue-bootstrap; do
  for fn in coding-standards.md architecture.md quality-gates.md review-checklist.md; do
    if grep -qE "\.devt/memory|ADR override|ADR alignment|memory affects|memory list decision|ADR/REJ alignment" "$ROOT/templates/$tpl/$fn"; then
      pass "templates/$tpl/$fn has memory layer reference"
    else
      fail "templates/$tpl/$fn missing memory layer reference"
    fi
  done
done

# Non-dev commands have Memory integration subsection
for cmd in forensics thread note do session-report weekly-report; do
  if grep -q "Memory integration" "$ROOT/commands/$cmd.md"; then
    pass "commands/$cmd.md has Memory integration section"
  else
    fail "commands/$cmd.md missing Memory integration section"
  fi
done

echo "== Phase 6 (v0.21.0): MCP telemetry + comprehensive bundle round-trip =="

# --- MCP telemetry: fire calls, then verify trace + mcp-stats aggregate ---
TMCP=$(mktemp -d)
(cd "$TMCP" && node "$CLI" setup --template blank --mode create >/dev/null 2>&1 && node "$CLI" memory init >/dev/null 2>&1)
# Fire 1 success + 1 SELECT-only-rejected call
printf '%s\n%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_active","arguments":{}}}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"query_index","arguments":{"sql":"DROP TABLE x"}}}' \
  | (cd "$TMCP" && timeout 3 node "$ROOT/bin/devt-memory-mcp.cjs" >/dev/null 2>&1)
TRACE="$TMCP/.devt/memory/_mcp-trace.jsonl"
if [ -f "$TRACE" ] && [ "$(wc -l < "$TRACE")" -ge 2 ]; then
  pass "MCP trace file written with at least 2 entries"
else
  fail "MCP trace file missing or empty (found $(wc -l < "$TRACE" 2>/dev/null || echo 0) lines)"
fi
# Trace records must have privacy-safe fields (no `args` or `result`)
if [ -f "$TRACE" ] && grep -qE '"tool":|"duration_ms":|"args_fp":' "$TRACE" && ! grep -qE '"sql":|"args":\{[^}]+}' "$TRACE"; then
  pass "MCP trace records use privacy-safe fields (fp, sizes — no raw args/results)"
else
  fail "MCP trace recorded raw args or missing required fields"
fi
# Aggregate via mcp-stats
STATS=$(cd "$TMCP" && node "$CLI" mcp-stats 2>/dev/null)
if echo "$STATS" | grep -q '"total_calls"' && echo "$STATS" | grep -q '"p95"'; then
  pass "mcp-stats emits aggregate with p95"
else
  fail "mcp-stats missing required fields"
fi
# Error rate is non-zero (we forced an INVALID_SQL)
if echo "$STATS" | grep -qE '"total_errors":\s*[1-9]' && echo "$STATS" | grep -q '"INVALID_SQL"'; then
  pass "mcp-stats records INVALID_SQL error_code"
else
  fail "mcp-stats did not capture INVALID_SQL error"
fi
# Filter by --tool
FILTERED=$(cd "$TMCP" && node "$CLI" mcp-stats --tool=list_active 2>/dev/null)
if echo "$FILTERED" | grep -qE '"total_calls":\s*1' && ! echo "$FILTERED" | grep -q "query_index"; then
  pass "mcp-stats --tool filter narrows results"
else
  fail "mcp-stats --tool filter broken"
fi
# --prune-older-than succeeds idempotently
PRUNE=$(cd "$TMCP" && node "$CLI" mcp-stats --prune-older-than=1d 2>/dev/null)
if echo "$PRUNE" | grep -q '"kept"'; then
  pass "mcp-stats --prune-older-than runs without error"
else
  fail "mcp-stats --prune-older-than failed"
fi
rm -rf "$TMCP"

# --- Comprehensive bundle round-trip: all 4 doc types + REJ search_keywords + links graph ---
TBR=$(mktemp -d)
(cd "$TBR" && node "$CLI" setup --template blank --mode create >/dev/null 2>&1)
# Author 1 ADR (with affects_paths/symbols + links to CON-001)
cat > "$TBR/.devt/memory/decisions/ADR-001-argon2.md" <<'EOF'
---
id: ADR-001
title: "Argon2 password hashing"
doc_type: decision
domain: security
status: active
confidence: explicit
summary: "Use argon2 for password hashing per NIST recommendation."
affects_paths:
  - "src/auth/**"
affects_symbols:
  - "AuthService"
  - "PasswordValidator"
links:
  - id: CON-001
    type: depends_on
created_at: "2026-05-05T10:00:00Z"
created_by: user
---

# ADR-001 — Argon2

Argon2 is memory-hard.
EOF
# Author 1 Concept linked from the ADR
cat > "$TBR/.devt/memory/concepts/CON-001-auth-domain.md" <<'EOF'
---
id: CON-001
title: "Auth domain model"
doc_type: concept
domain: security
status: active
confidence: explicit
summary: "Auth domain comprises AuthService and SessionManager."
affects_symbols:
  - "AuthService"
  - "SessionManager"
created_at: "2026-05-05T10:01:00Z"
created_by: user
---

# CON-001 — Auth domain

Definitions of AuthService and SessionManager.
EOF
# Author 1 Flow that implements ADR-001
cat > "$TBR/.devt/memory/flows/FLOW-001-login.md" <<'EOF'
---
id: FLOW-001
title: "Login handshake"
doc_type: flow
domain: security
status: active
confidence: observed
summary: "3-step login: validate input, hash with Argon2, mint session JWT."
affects_paths:
  - "src/auth/login.ts"
links:
  - id: ADR-001
    type: implements
created_at: "2026-05-05T10:02:00Z"
created_by: user
---

# FLOW-001 — Login

Steps: 1. Validate. 2. Hash. 3. Mint.
EOF
# Author 1 REJ tombstone with search_keywords
cat > "$TBR/.devt/memory/rejected/REJ-001-bcrypt.md" <<'EOF'
---
id: REJ-001
title: "Bcrypt for passwords"
doc_type: rejected
domain: security
status: rejected
confidence: explicit
summary: "Bcrypt rejected — not memory-hard, vulnerable to GPU attacks."
reason: security
search_keywords:
  - "bcrypt"
  - "BCrypt password hashing"
links:
  - id: ADR-001
    type: relates_to
created_at: "2026-05-05T10:03:00Z"
created_by: user
---

# REJ-001 — Bcrypt

Reasoning: Argon2 is memory-hard; bcrypt is not.
EOF
(cd "$TBR" && node "$CLI" memory index >/dev/null 2>&1)
# Export bundle
(cd "$TBR" && node "$CLI" memory export --out=full-bundle.json >/dev/null 2>&1)
if [ -f "$TBR/full-bundle.json" ]; then
  pass "round-trip: bundle written for all 4 doc types"
else
  fail "round-trip: bundle not written"
fi
# Verify bundle structure: all 4 docs + REJ search_keywords + links preserved
node -e "
  const b = JSON.parse(require('fs').readFileSync('$TBR/full-bundle.json','utf8'));
  const ids = b.docs.map(d => d.id).sort();
  const expected = ['ADR-001','CON-001','FLOW-001','REJ-001'];
  if (JSON.stringify(ids) !== JSON.stringify(expected)) { console.log('FAIL:ids:'+JSON.stringify(ids)); process.exit(1); }
  const rej = b.docs.find(d => d.id === 'REJ-001');
  if (!rej.frontmatter.search_keywords || rej.frontmatter.search_keywords.length !== 2) { console.log('FAIL:rej-keywords:'+JSON.stringify(rej.frontmatter.search_keywords)); process.exit(1); }
  if (rej.frontmatter.search_keywords[0] !== 'bcrypt') { console.log('FAIL:rej-kw-first:'+rej.frontmatter.search_keywords[0]); process.exit(1); }
  const adr = b.docs.find(d => d.id === 'ADR-001');
  if (!adr.frontmatter.links || adr.frontmatter.links[0].id !== 'CON-001' || adr.frontmatter.links[0].type !== 'depends_on') { console.log('FAIL:adr-links'); process.exit(1); }
  if (!adr.frontmatter.affects_paths || !adr.frontmatter.affects_symbols) { console.log('FAIL:adr-affects'); process.exit(1); }
  if (adr.frontmatter.affects_symbols.length !== 2) { console.log('FAIL:adr-symbols:'+JSON.stringify(adr.frontmatter.affects_symbols)); process.exit(1); }
  console.log('OK');
" 2>&1 | head -5 | grep -q "^OK" && pass "round-trip: bundle preserves all doc types + REJ search_keywords + links + affects_paths/symbols" || fail "round-trip: bundle structure check failed"

# Re-import to a fresh project, verify all 4 round-trip
TBR2=$(mktemp -d)
(cd "$TBR2" && node "$CLI" setup --template blank --mode create >/dev/null 2>&1)
IMP_OUT=$(cd "$TBR2" && node "$CLI" memory import "$TBR/full-bundle.json" 2>/dev/null)
if echo "$IMP_OUT" | grep -qE '"created":\s*4'; then
  pass "round-trip: import created 4 docs (ADR + CON + FLOW + REJ)"
else
  fail "round-trip: import did not create 4 docs (got: $(echo "$IMP_OUT" | grep created))"
fi

# Verify each doc landed in its right subdir
for spec in "decisions:ADR-001-argon2.md" "concepts:CON-001-auth-domain.md" "flows:FLOW-001-login.md" "rejected:REJ-001-bcrypt.md"; do
  sub="${spec%%:*}"
  fn="${spec##*:}"
  if [ -f "$TBR2/.devt/memory/$sub/$fn" ]; then
    pass "round-trip: imported file at .devt/memory/$sub/$fn"
  else
    fail "round-trip: missing .devt/memory/$sub/$fn"
  fi
done

# Verify REJ search_keywords survive the markdown round-trip
if grep -qE '^  - "?bcrypt"?$' "$TBR2/.devt/memory/rejected/REJ-001-bcrypt.md" 2>/dev/null; then
  pass "round-trip: REJ search_keywords[0]='bcrypt' preserved in markdown"
else
  fail "round-trip: REJ search_keywords lost in markdown re-render"
fi

# Verify links survive: re-export and assert ADR-001 still links to CON-001
(cd "$TBR2" && node "$CLI" memory index >/dev/null 2>&1)
(cd "$TBR2" && node "$CLI" memory export --out=re-export.json >/dev/null 2>&1)
node -e "
  const b = JSON.parse(require('fs').readFileSync('$TBR2/re-export.json','utf8'));
  const adr = b.docs.find(d => d.id === 'ADR-001');
  const ok = adr && adr.frontmatter && adr.frontmatter.links && adr.frontmatter.links[0] && adr.frontmatter.links[0].id === 'CON-001' && adr.frontmatter.links[0].type === 'depends_on';
  console.log(ok ? 'OK' : 'FAIL: links not preserved through round-trip');
" 2>&1 | grep -q "^OK" && pass "round-trip: links survive markdown→JSON→markdown→JSON" || fail "round-trip: links lost"

# Verify --include filter exports only requested types
(cd "$TBR" && node "$CLI" memory export --out=rej-only.json --include=rejected >/dev/null 2>&1)
node -e "
  const b = JSON.parse(require('fs').readFileSync('$TBR/rej-only.json','utf8'));
  const ok = b.docs.length === 1 && b.docs[0].id === 'REJ-001';
  console.log(ok ? 'OK' : 'FAIL: --include did not filter (got '+b.docs.length+' docs)');
" 2>&1 | grep -q "^OK" && pass "round-trip: --include=rejected filters to 1 doc" || fail "round-trip: --include filter broken"

rm -rf "$TBR" "$TBR2"

# Config has memory.mcp_telemetry default
TEL_DEFAULT=$(node -e "console.log(require('$ROOT/bin/modules/config.cjs').DEFAULTS.memory.mcp_telemetry)")
if [ "$TEL_DEFAULT" = "true" ]; then
  pass "memory.mcp_telemetry default is true"
else
  fail "memory.mcp_telemetry default is '$TEL_DEFAULT' (expected true)"
fi

# bin/modules/mcp-stats.cjs exists
pass_if_file "$ROOT/bin/modules/mcp-stats.cjs" "bin/modules/mcp-stats.cjs exists"

echo "== Phase 7 (v0.22.0): configurable memory paths (multi-root) =="

# Default: single-root (memory.paths null) — backward compat
DEFAULT_PATHS=$(node -e "console.log(JSON.stringify(require('$ROOT/bin/modules/config.cjs').DEFAULTS.memory.paths))")
if [ "$DEFAULT_PATHS" = "null" ]; then
  pass "memory.paths default is null (single-root backward compat)"
else
  fail "memory.paths default is '$DEFAULT_PATHS' (expected null)"
fi

# Multi-root scenario: shared root + project-local override
TSHARED=$(mktemp -d)
TPROJ=$(mktemp -d)
mkdir -p "$TSHARED/decisions"
cat > "$TSHARED/decisions/ADR-001-shared.md" <<'ADR_EOF'
---
id: ADR-001
title: "Shared rule"
doc_type: decision
domain: security
status: active
confidence: explicit
summary: "From shared root."
created_at: "2026-05-05T00:00:00Z"
created_by: user
---

# ADR-001 (shared)
ADR_EOF
(cd "$TPROJ" && node "$CLI" setup --template blank --mode create >/dev/null 2>&1)
cat > "$TPROJ/.devt/memory/decisions/ADR-001-local.md" <<'ADR_EOF'
---
id: ADR-001
title: "Local override"
doc_type: decision
domain: security
status: active
confidence: explicit
summary: "Project-local override."
created_at: "2026-05-05T00:00:00Z"
created_by: user
---

# ADR-001 (local)
ADR_EOF
cat > "$TPROJ/.devt/memory/decisions/ADR-007-project.md" <<'ADR_EOF'
---
id: ADR-007
title: "Project-only"
doc_type: decision
domain: caching
status: active
confidence: explicit
summary: "Only in project."
created_at: "2026-05-05T00:00:00Z"
created_by: user
---

# ADR-007
ADR_EOF
# Configure memory.paths
node -e "
  const fs = require('fs');
  const cfgPath = '$TPROJ/.devt/config.json';
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.memory = cfg.memory || {};
  cfg.memory.paths = ['$TSHARED', '.devt/memory'];
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
"
# Index from project dir
INDEX_OUT=$(cd "$TPROJ" && node "$CLI" memory index 2>/dev/null)
if echo "$INDEX_OUT" | grep -qE '"inserted":\s*2'; then
  pass "multi-root: indexed 2 docs (ADR-001 + ADR-007, conflict deduped)"
else
  fail "multi-root: index did not produce 2 docs (got: $(echo "$INDEX_OUT" | grep inserted))"
fi
if echo "$INDEX_OUT" | grep -qE '"conflict_count":\s*1'; then
  pass "multi-root: ADR-001 conflict reported in rebuild result"
else
  fail "multi-root: conflict not surfaced (got: $(echo "$INDEX_OUT" | grep conflict))"
fi
if echo "$INDEX_OUT" | grep -q "memory_roots"; then
  pass "multi-root: rebuild result includes memory_roots array"
else
  fail "multi-root: memory_roots missing from rebuild result"
fi
# Last-wins: ADR-001 should be the LOCAL one, not the shared one
GET_OUT=$(cd "$TPROJ" && node "$CLI" memory get ADR-001 2>/dev/null)
if echo "$GET_OUT" | grep -q '"title": "Local override"'; then
  pass "multi-root: last-wins precedence — local ADR-001 shadows shared"
else
  fail "multi-root: last-wins precedence broken"
fi
if echo "$GET_OUT" | grep -q "source_root"; then
  pass "multi-root: get exposes source_root for provenance"
else
  fail "multi-root: source_root missing from get output"
fi
# ADR-007 is project-only and should still be there
if cd "$TPROJ" && node "$CLI" memory get ADR-007 2>/dev/null | grep -q '"id": "ADR-007"'; then
  pass "multi-root: project-only ADR-007 still indexed"
else
  fail "multi-root: project-only ADR-007 missing"
fi
# Rejection of unsafe path entries (null byte etc.)
node -e "
  const fs = require('fs');
  const cfgPath = '$TPROJ/.devt/config.json';
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.memory.paths = ['/some/path evil', 12345, '$TSHARED', '.devt/memory'];
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
"
ROOTS=$(cd "$TPROJ" && node -e "
  const m = require('$ROOT/bin/modules/memory.cjs');
  console.log(JSON.stringify(m.getMemoryRoots()));
" 2>/dev/null)
if echo "$ROOTS" | grep -q "$TSHARED" && ! echo "$ROOTS" | grep -q "nullbyte" && ! echo "$ROOTS" | grep -q "12345"; then
  pass "multi-root: invalid entries (null-byte, non-string) silently dropped"
else
  fail "multi-root: invalid entries leaked into roots ($ROOTS)"
fi
rm -rf "$TSHARED" "$TPROJ"

# When memory.paths is null (default), behavior is single-root
TPROJ2=$(mktemp -d)
(cd "$TPROJ2" && node "$CLI" setup --template blank --mode create >/dev/null 2>&1)
ROOTS_DEFAULT=$(cd "$TPROJ2" && node -e "
  const m = require('$ROOT/bin/modules/memory.cjs');
  const r = m.getMemoryRoots();
  console.log(r.length);
" 2>/dev/null)
if [ "$ROOTS_DEFAULT" = "1" ]; then
  pass "multi-root: getMemoryRoots returns single project-local root by default"
else
  fail "multi-root: default getMemoryRoots returned $ROOTS_DEFAULT roots (expected 1)"
fi
rm -rf "$TPROJ2"

# Public API exports gained getMemoryRoots + getSubdirPathFor
node -e "
  const m = require('$ROOT/bin/modules/memory.cjs');
  if (typeof m.getMemoryRoots === 'function' && typeof m.getSubdirPathFor === 'function') process.exit(0);
  process.exit(1);
" && pass "memory.cjs exports getMemoryRoots + getSubdirPathFor" || fail "memory.cjs missing new exports"

# Project-local always wins — even when user puts .devt/memory FIRST in memory.paths,
# it must be re-positioned to the END so last-wins precedence keeps local on top.
TFORCED=$(mktemp -d)
(cd "$TFORCED" && node "$CLI" setup --template blank --mode create >/dev/null 2>&1)
TSHARED2=$(mktemp -d)
mkdir -p "$TSHARED2/decisions"
node -e "
  const fs = require('fs');
  const cfgPath = '$TFORCED/.devt/config.json';
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.memory = { paths: ['.devt/memory', '$TSHARED2'] };
  fs.writeFileSync(cfgPath, JSON.stringify(cfg));
"
LAST_ROOT=$(cd "$TFORCED" && node -e "
  const m = require('$ROOT/bin/modules/memory.cjs');
  const r = m.getMemoryRoots();
  console.log(r[r.length - 1]);
" 2>/dev/null)
if [[ "$LAST_ROOT" == */.devt/memory ]]; then
  pass "multi-root: project-local always last (even when user puts it first)"
else
  fail "multi-root: project-local NOT last — got '$LAST_ROOT' (precedence broken)"
fi
rm -rf "$TFORCED" "$TSHARED2"

# memory export --all-roots includes shared docs; default scopes to project-local only
TLOCAL=$(mktemp -d)
TSH=$(mktemp -d)
mkdir -p "$TSH/decisions"
cat > "$TSH/decisions/ADR-001-shared.md" <<'ADR_EOF'
---
id: ADR-001
title: "Shared"
doc_type: decision
status: active
confidence: explicit
summary: "Shared root."
created_at: "2026-05-05T00:00:00Z"
created_by: user
---

# Shared
ADR_EOF
(cd "$TLOCAL" && node "$CLI" setup --template blank --mode create >/dev/null 2>&1)
cat > "$TLOCAL/.devt/memory/decisions/ADR-007-local.md" <<'ADR_EOF'
---
id: ADR-007
title: "Local"
doc_type: decision
status: active
confidence: explicit
summary: "Project local."
created_at: "2026-05-05T00:00:00Z"
created_by: user
---

# Local
ADR_EOF
node -e "
  const fs = require('fs');
  const p = '$TLOCAL/.devt/config.json';
  const c = JSON.parse(fs.readFileSync(p, 'utf8'));
  c.memory = { ...c.memory || {}, paths: ['$TSH', '.devt/memory'] };
  fs.writeFileSync(p, JSON.stringify(c));
"
(cd "$TLOCAL" && node "$CLI" memory export --out=default-bundle.json >/dev/null 2>&1)
DEFAULT_IDS=$(node -e "
  const b = JSON.parse(require('fs').readFileSync('$TLOCAL/default-bundle.json','utf8'));
  console.log(b.docs.map(d => d.id).sort().join(','), '|all_roots:', b.all_roots_mode);
")
if [ "$DEFAULT_IDS" = "ADR-007 |all_roots: false" ]; then
  pass "memory export default: project-local only (ADR-007), all_roots_mode=false"
else
  fail "memory export default scope wrong: $DEFAULT_IDS"
fi
(cd "$TLOCAL" && node "$CLI" memory export --out=all-bundle.json --all-roots >/dev/null 2>&1)
ALL_IDS=$(node -e "
  const b = JSON.parse(require('fs').readFileSync('$TLOCAL/all-bundle.json','utf8'));
  console.log(b.docs.map(d => d.id).sort().join(','), '|all_roots:', b.all_roots_mode);
")
if [ "$ALL_IDS" = "ADR-001,ADR-007 |all_roots: true" ]; then
  pass "memory export --all-roots: union of all roots (ADR-001 + ADR-007), all_roots_mode=true"
else
  fail "memory export --all-roots wrong: $ALL_IDS"
fi
rm -rf "$TLOCAL" "$TSH"

# Multi-root awareness in skills + agents + MCP descriptions
for f in skills/memory-curation/SKILL.md skills/memory-pre-flight/SKILL.md agents/architect.md skills/architecture-health-scanner/SKILL.md; do
  if grep -q "v0\.22\|multi-root\|memory\.paths\|source_root" "$ROOT/$f"; then
    pass "$f surfaces multi-root awareness"
  else
    fail "$f missing multi-root awareness"
  fi
done
# MCP tool descriptions mention source_root or v0.22 multi-root behavior
for tool in get_doc list_active get_context_for_path; do
  if grep -A4 "^  $tool: {" "$ROOT/bin/devt-memory-mcp.cjs" | grep -q "source_root\|v0\.22"; then
    pass "MCP tool '$tool' description mentions source_root or v0.22 multi-root"
  else
    fail "MCP tool '$tool' description missing source_root mention"
  fi
done

echo "== Phase 8 (v0.23.0): memory paths/diff + health MEM_* + mcp-stats --top + token-report baseline =="

# memory paths default (single-root)
TPATHS=$(mktemp -d)
(cd "$TPATHS" && node "$CLI" setup --template blank --mode create >/dev/null 2>&1)
PATHS_OUT=$(cd "$TPATHS" && node "$CLI" memory paths 2>/dev/null)
if echo "$PATHS_OUT" | grep -qE '"count":\s*1' && echo "$PATHS_OUT" | grep -q '"project_local"'; then
  pass "memory paths: default returns single project-local root"
else
  fail "memory paths default broken"
fi

# memory paths --validate flags missing roots
node -e "
  const fs=require('fs');
  const c=JSON.parse(fs.readFileSync('$TPATHS/.devt/config.json','utf8'));
  c.memory={...(c.memory||{}),paths:['/non/existent/shared','.devt/memory']};
  fs.writeFileSync('$TPATHS/.devt/config.json',JSON.stringify(c));
"
VAL_OUT=$(cd "$TPATHS" && node "$CLI" memory paths --validate 2>/dev/null || true)
if echo "$VAL_OUT" | grep -q "MEM_PATH_UNREACHABLE" && echo "$VAL_OUT" | grep -qE '"errors":\s*1'; then
  pass "memory paths --validate flags MEM_PATH_UNREACHABLE on missing root"
else
  fail "memory paths --validate did not flag missing root"
fi
rm -rf "$TPATHS"

# memory diff: empty roots both — sanity check that diff returns valid JSON shape.
# Run from a project we just init'd so config resolution doesn't fall back to warning paths.
TDIFF_PROJ=$(mktemp -d)
TA_DIFF=$(mktemp -d); TB_DIFF=$(mktemp -d)
(cd "$TDIFF_PROJ" && node "$CLI" setup --template blank --mode create >/dev/null 2>&1)
DIFF_OUT=$(cd "$TDIFF_PROJ" && node "$CLI" memory diff "$TA_DIFF" "$TB_DIFF" 2>/dev/null || true)
if echo "$DIFF_OUT" | grep -q '"a_count"' && echo "$DIFF_OUT" | grep -q '"added"' && echo "$DIFF_OUT" | grep -q '"removed"' && echo "$DIFF_OUT" | grep -q '"changed"'; then
  pass "memory diff: emits added/removed/changed shape"
else
  fail "memory diff JSON shape broken (got len=${#DIFF_OUT})"
fi
rm -rf "$TA_DIFF" "$TB_DIFF" "$TDIFF_PROJ"

# health.cjs native MEM_PATH_UNREACHABLE check
THLT=$(mktemp -d)
(cd "$THLT" && node "$CLI" setup --template blank --mode create >/dev/null 2>&1 && node "$CLI" memory init >/dev/null 2>&1)
node -e "
  const fs=require('fs');
  const c=JSON.parse(fs.readFileSync('$THLT/.devt/config.json','utf8'));
  c.memory={...(c.memory||{}),paths:['/non/existent','.devt/memory']};
  fs.writeFileSync('$THLT/.devt/config.json',JSON.stringify(c));
"
HEALTH_OUT=$(cd "$THLT" && node "$CLI" health 2>/dev/null)
if echo "$HEALTH_OUT" | grep -q "MEM_PATH_UNREACHABLE"; then
  pass "health native check surfaces MEM_PATH_UNREACHABLE"
else
  fail "health did not surface MEM_PATH_UNREACHABLE"
fi
rm -rf "$THLT"

# mcp-stats --top + --by validation
TMS=$(mktemp -d)
(cd "$TMS" && node "$CLI" setup --template blank --mode create >/dev/null 2>&1 && node "$CLI" memory init >/dev/null 2>&1)
printf '%s\n%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_active","arguments":{}}}' \
  | (cd "$TMS" && timeout 2 node "$ROOT/bin/devt-memory-mcp.cjs" >/dev/null 2>&1)
TOP_OUT=$(cd "$TMS" && node "$CLI" mcp-stats --top=1 --by=calls 2>/dev/null)
if echo "$TOP_OUT" | grep -qE '"top":\s*1' && echo "$TOP_OUT" | grep -qE '"by":\s*"calls"'; then
  pass "mcp-stats --top=N --by=calls applies filter"
else
  fail "mcp-stats --top filter broken"
fi
INVALID_BY=$(cd "$TMS" && node "$CLI" mcp-stats --top=1 --by=garbage 2>&1 || true)
if echo "$INVALID_BY" | grep -q "must be one of"; then
  pass "mcp-stats rejects invalid --by value"
else
  fail "mcp-stats did not reject invalid --by"
fi
rm -rf "$TMS"

# token-report --baseline + --compare round-trip (run from devt project so session logs exist)
TR_BASELINE=/tmp/devt-smoke-baseline.json
(cd "$ROOT" && node "$CLI" token-report --sessions=1 --baseline="$TR_BASELINE" >/dev/null 2>&1) || true
if [ -f "$TR_BASELINE" ]; then
  pass "token-report --baseline writes snapshot file"
else
  fail "token-report --baseline did not write file"
fi
COMPARE_OUT=$(cd "$ROOT" && node "$CLI" token-report --sessions=1 --compare="$TR_BASELINE" 2>/dev/null || true)
if echo "$COMPARE_OUT" | grep -q '"comparison"' && echo "$COMPARE_OUT" | grep -q '"relative_change_pct"'; then
  pass "token-report --compare returns delta against baseline"
else
  fail "token-report --compare broken"
fi
rm -f "$TR_BASELINE"

# health.cjs MEM_* codes registered in CHECKS catalog
for code in MEM_PATH_UNREACHABLE MEM_INDEX_STALE MEM_VALIDATE_ERRORS MEM_CONFLICT_HIGH; do
  if grep -q "$code:" "$ROOT/bin/modules/health.cjs"; then
    pass "health.cjs CHECKS catalog includes $code"
  else
    fail "health.cjs missing $code definition"
  fi
done

# v0.25.0 — CCA v21.0 §10 SQL views + symbol NOCASE + self-link detection.
TMP_VIEW_PROJ=$(mktemp -d)
mkdir -p "$TMP_VIEW_PROJ/.devt/memory/decisions" "$TMP_VIEW_PROJ/.devt/memory/concepts"

# Helper: write a memory doc fixture. Trailing positional arg is extra YAML
# inserted before the closing ---.
write_memory_doc() {
  local outfile="$1" id="$2" doc_type="$3" status="$4" confidence="$5" extra_yaml="$6"
  {
    printf -- '---\n'
    printf 'id: %s\n' "$id"
    printf 'doc_type: %s\n' "$doc_type"
    printf 'status: %s\n' "$status"
    printf 'confidence: %s\n' "$confidence"
    printf 'title: %s smoke fixture\n' "$id"
    printf 'summary: smoke test fixture\n'
    printf 'created_at: 2026-04-01T00:00:00Z\n'
    [[ -n "$extra_yaml" ]] && printf '%s\n' "$extra_yaml"
    printf -- '---\nBody\n'
  } > "$outfile"
}

# Helper: read-only sqlite query against the fixture project's index.
mem_db_query() {
  local tmpdir="$1" js="$2"
  node -e "
    const sqlite = require('node:sqlite');
    const db = new sqlite.DatabaseSync('$tmpdir/.devt/memory/index.db', { readOnly: true });
    $js
    db.close();
  " 2>/dev/null || echo ""
}

write_memory_doc "$TMP_VIEW_PROJ/.devt/memory/decisions/ADR-001-test.md" \
  ADR-001 decision candidate speculative ""
write_memory_doc "$TMP_VIEW_PROJ/.devt/memory/concepts/CON-001-test.md" \
  CON-001 concept active explicit "affects_symbols: [UserService]"
write_memory_doc "$TMP_VIEW_PROJ/.devt/memory/decisions/ADR-002-selflink.md" \
  ADR-002 decision active explicit "links:
  - id: ADR-002
    type: relates_to"
(cd "$TMP_VIEW_PROJ" && node "$CLI" memory index >/dev/null 2>&1) || true

VIEW_NAMES=$(mem_db_query "$TMP_VIEW_PROJ" \
  "console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE type='view' ORDER BY name\").all().map(x => x.name).join(','));")
for view in pending_review speculative_candidates constraint_chains stale_speculative; do
  if echo "$VIEW_NAMES" | grep -q "$view"; then
    pass "memory index creates SQL view: $view"
  else
    fail "memory index missing SQL view: $view"
  fi
done

STALE_COUNT=$(mem_db_query "$TMP_VIEW_PROJ" \
  "console.log(db.prepare('SELECT COUNT(*) c FROM stale_speculative WHERE id=?').get('ADR-001').c);")
if [ "$STALE_COUNT" = "1" ]; then
  pass "stale_speculative view surfaces ADR > 30 days old"
else
  fail "stale_speculative view did not surface stale candidate (count=$STALE_COUNT)"
fi

SYM_LOWER=$(cd "$TMP_VIEW_PROJ" && node "$CLI" memory affects-symbol userservice 2>/dev/null | grep -c '"id": "CON-001"' || true)
SYM_UPPER=$(cd "$TMP_VIEW_PROJ" && node "$CLI" memory affects-symbol UserService 2>/dev/null | grep -c '"id": "CON-001"' || true)
if [ "$SYM_LOWER" -ge 1 ] && [ "$SYM_UPPER" -ge 1 ]; then
  pass "memory affects-symbol is case-insensitive (NOCASE collation)"
else
  fail "memory affects-symbol case-sensitivity broken (lower=$SYM_LOWER upper=$SYM_UPPER)"
fi

SELF_OUT=$(cd "$TMP_VIEW_PROJ" && node "$CLI" memory validate 2>/dev/null || true)
if echo "$SELF_OUT" | grep -q '"category": "self-link"'; then
  pass "memory validate flags self-link"
else
  fail "memory validate missed self-link on ADR-002"
fi

# CCA v27 §2 Symbol Decay — Graphify-disabled graceful skip.
# affects_symbols on docs but graphify.enabled=false MUST NOT emit stale-symbol
# false positives. Real decay detection only fires when Graphify is ready;
# absence of Graphify is not absence of governance.
if echo "$SELF_OUT" | grep -q '"category": "stale-symbol"'; then
  fail "memory validate emitted stale-symbol when Graphify is disabled (must skip gracefully)"
else
  pass "memory validate skips stale-symbol checks when Graphify is disabled"
fi
rm -rf "$TMP_VIEW_PROJ"

# Curator-gated harvest wiring: `memory suggest` MUST exit 0 cleanly on:
#  (a) project with no .devt/memory/ directory  (b) no claude-mem installed
#  (c) zero ⚖️/🔵 observations  — anything else would break the unconditional
#  harvest_observations step in dev-workflow / lesson-extraction / quick-implement.
TMP_HARVEST_PROJ=$(mktemp -d)
( cd "$TMP_HARVEST_PROJ" && git init -q )
HARVEST_OUT=$(cd "$TMP_HARVEST_PROJ" && node "$CLI" memory suggest 2>&1)
HARVEST_RC=$?
if [ "$HARVEST_RC" -eq 0 ] && echo "$HARVEST_OUT" | grep -q '"total_candidates": 0'; then
  pass "memory suggest is idempotent on empty project (unconditional harvest safety)"
else
  fail "memory suggest non-idempotent on empty project — rc=$HARVEST_RC"
fi
rm -rf "$TMP_HARVEST_PROJ"

# Curator-gated harvest is wired into all three retro/finalize touchpoints.
# Without these grep checks, the curator dispatch can silently drift back to
# playbook-only (the bug this fix addresses).
HARVEST_WIRED_COUNT=0
for wf in "$ROOT/workflows/dev-workflow.md" \
          "$ROOT/workflows/lesson-extraction.md" \
          "$ROOT/workflows/quick-implement.md"; do
  if grep -q 'memory suggest' "$wf"; then
    HARVEST_WIRED_COUNT=$((HARVEST_WIRED_COUNT + 1))
  fi
done
if [ "$HARVEST_WIRED_COUNT" -eq 3 ]; then
  pass "memory suggest is wired into dev-workflow + lesson-extraction + quick-implement"
else
  fail "memory suggest missing from one of the three workflows ($HARVEST_WIRED_COUNT/3)"
fi

# Graphify freshness exposes lag_commits per its JSDoc contract. Without this
# field, the Pre-Flight Brief's staleness check (introduced this version) would
# silently no-op forever. The check verifies the contract holds even when
# Graphify is disabled — degraded payload should NOT include lag_commits, but
# also MUST NOT throw. Use a fresh tmp project where graphify is disabled.
TFRESH=$(mktemp -d)
( cd "$TFRESH" && git init -q )
FRESH_OUT=$(cd "$TFRESH" && node "$CLI" graphify freshness 2>/dev/null || true)
if echo "$FRESH_OUT" | grep -q '"state":'; then
  pass "graphify freshness returns structured state field (Brief staleness contract)"
else
  fail "graphify freshness output missing state field"
fi
rm -rf "$TFRESH"

# GRAPHIFY_MCP_UNREGISTERED health check: when graphify is on PATH but .mcp.json
# lacks the entry, health emits info-level drift warning (NOT an auto-repair).
if command -v graphify >/dev/null 2>&1; then
  TGRA=$(mktemp -d)
  ( cd "$TGRA" && git init -q )
  # Health check requires .devt/ to exist (E001 early-returns otherwise) — scaffold blank first.
  ( cd "$TGRA" && node "$CLI" setup --template blank --mode create >/dev/null 2>&1 )
  # Strip any auto-registered graphify entry from .mcp.json so the drift check has something to detect.
  if [ -f "$TGRA/.mcp.json" ]; then
    node -e "const fs=require('fs');const f='$TGRA/.mcp.json';const j=JSON.parse(fs.readFileSync(f,'utf8'));if(j.mcpServers&&j.mcpServers.graphify){delete j.mcpServers.graphify;fs.writeFileSync(f,JSON.stringify(j,null,2));}"
  fi
  GRA_OUT=$(cd "$TGRA" && node "$CLI" health 2>/dev/null || true)
  if echo "$GRA_OUT" | grep -q "GRAPHIFY_MCP_UNREGISTERED"; then
    pass "health detects Graphify-on-PATH without .mcp.json registration"
  else
    fail "health missed GRAPHIFY_MCP_UNREGISTERED drift"
  fi
  # Must be info severity (warn-only, not auto-repairable — don't stomp .mcp.json)
  if echo "$GRA_OUT" | grep -q '"code":"GRAPHIFY_MCP_UNREGISTERED","severity":"info"'; then
    pass "GRAPHIFY_MCP_UNREGISTERED is info-severity (advisory, not auto-repairable)"
  else
    fail "GRAPHIFY_MCP_UNREGISTERED severity mismatch (expected info)"
  fi
  rm -rf "$TGRA"
else
  pass "GRAPHIFY_MCP_UNREGISTERED check skipped (Graphify not on PATH)"
  pass "GRAPHIFY_MCP_UNREGISTERED severity check skipped (Graphify not on PATH)"
fi

# Curator dispatches in dev-workflow + lesson-extraction MUST pass _suggestions.md
# in <files_to_read>, otherwise dual-path curation degrades to playbook-only.
DISPATCH_WIRED_COUNT=0
for wf in "$ROOT/workflows/dev-workflow.md" \
          "$ROOT/workflows/lesson-extraction.md"; do
  if grep -q '_suggestions\.md' "$wf"; then
    DISPATCH_WIRED_COUNT=$((DISPATCH_WIRED_COUNT + 1))
  fi
done
if [ "$DISPATCH_WIRED_COUNT" -eq 2 ]; then
  pass "curator dispatches reference _suggestions.md in dev-workflow + lesson-extraction"
else
  fail "curator dispatch missing _suggestions.md context ($DISPATCH_WIRED_COUNT/2)"
fi

# project-init.md prompts the user to install graphify's post-commit hook when
# graphify is on PATH but the hook is missing. Without this, graph drift causes
# stale-symbol false alarms after every refactor.
if grep -q '"prompt_graphify_hook"' "$ROOT/workflows/project-init.md" \
   && grep -q "graphify hook install" "$ROOT/workflows/project-init.md"; then
  pass "project-init prompts graphify hook install when needed"
else
  fail "project-init missing graphify hook install prompt"
fi

# project-init.md offers Graphify install instructions when absent and offers to
# flip graphify.enabled=true when present-but-disabled (silent-failure mode where
# Graphify is installed but devt's default graphify.enabled=false leaves it unused).
if grep -q '"prompt_graphify_setup"' "$ROOT/workflows/project-init.md" \
   && grep -q "graphify.enabled=true" "$ROOT/workflows/project-init.md" \
   && grep -q "pip install graphifyy" "$ROOT/workflows/project-init.md"; then
  pass "project-init prompts graphify install + enable when needed"
else
  fail "project-init missing graphify install/enable prompt"
fi

echo "== memory.enabled master switch =="
# When memory.enabled=false, the load-bearing memory surfaces (preflight Brief
# generation + discovery harvest) must short-circuit and return a disabled
# envelope without writing memory-layer artifacts. This regression-tests the
# gate wiring in preflight.cjs and discovery.cjs.
SWITCH_TMP=$(mktemp -d)
(
  cd "$SWITCH_TMP"
  git init -q
  mkdir -p .devt
  echo '{"memory":{"enabled":false}}' > .devt/config.json
)
if node "$CLI" preflight generate "smoke gate test" --root "$SWITCH_TMP" 2>/dev/null \
   | node -e "
       const r = JSON.parse(require('fs').readFileSync(0,'utf8'));
       process.exit(r.state === 'disabled' && r.brief_path === null ? 0 : 1);
     "; then
  pass "preflight short-circuits when memory.enabled=false"
else
  # Fallback: invoke from the temp project's cwd (preflight resolves root via cwd if --root unsupported)
  if (cd "$SWITCH_TMP" && node "$CLI" preflight generate "smoke gate test" 2>/dev/null) \
     | node -e "
         const r = JSON.parse(require('fs').readFileSync(0,'utf8'));
         process.exit(r.state === 'disabled' && r.brief_path === null ? 0 : 1);
       "; then
    pass "preflight short-circuits when memory.enabled=false"
  else
    fail "preflight did NOT short-circuit when memory.enabled=false"
  fi
fi

if (cd "$SWITCH_TMP" && node "$CLI" discovery harvest 2>/dev/null) \
   | node -e "
       const r = JSON.parse(require('fs').readFileSync(0,'utf8'));
       process.exit(r.state === 'disabled' && r.suggestions_path === null ? 0 : 1);
     "; then
  pass "discovery harvest short-circuits when memory.enabled=false"
else
  fail "discovery harvest did NOT short-circuit when memory.enabled=false"
fi

# Confirm no memory-layer artifact was written when disabled (the whole point).
if [ ! -f "$SWITCH_TMP/.devt/memory/_suggestions.md" ] && [ ! -f "$SWITCH_TMP/.devt/state/preflight-brief.md" ]; then
  pass "no memory-layer artifacts written when memory.enabled=false"
else
  fail "memory-layer artifact leaked despite memory.enabled=false"
fi
rm -rf "$SWITCH_TMP"

echo "== io.cjs atomic-write helpers =="
# Round-trip: atomicWriteFileSync writes content; read-back equals input.
if node -e "
  const { atomicWriteFileSync, atomicWriteJsonSync } = require('$ROOT/bin/modules/io.cjs');
  const fs = require('fs'), os = require('os'), path = require('path');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devt-io-'));
  const f = path.join(tmp, 'sample.txt');
  atomicWriteFileSync(f, 'hello\n');
  if (fs.readFileSync(f, 'utf8') !== 'hello\n') process.exit(1);
  const j = path.join(tmp, 'sample.json');
  atomicWriteJsonSync(j, { a: 1 });
  if (JSON.parse(fs.readFileSync(j, 'utf8')).a !== 1) process.exit(2);
  fs.rmSync(tmp, { recursive: true, force: true });
" 2>/dev/null; then
  pass "atomicWriteFileSync + atomicWriteJsonSync round-trip"
else
  fail "io.cjs round-trip failed"
fi

# Orphan cleanup: when renameSync fails (target is an existing non-empty dir on
# the same filesystem), the .tmp must be unlinked so a failed write doesn't leave
# stale state behind. Verifies the EXDEV/EACCES/EBUSY cleanup branch.
if node -e "
  const { atomicWriteFileSync } = require('$ROOT/bin/modules/io.cjs');
  const fs = require('fs'), os = require('os'), path = require('path');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devt-io-orphan-'));
  // Make target an existing directory with a child — rename(file -> nonemptydir) fails on POSIX.
  const target = path.join(tmp, 'target');
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'child'), 'x');
  let threw = false;
  try { atomicWriteFileSync(target, 'data'); } catch { threw = true; }
  if (!threw) process.exit(1);  // must rethrow original error
  if (fs.existsSync(target + '.tmp')) process.exit(2);  // orphan cleanup must have run
  fs.rmSync(tmp, { recursive: true, force: true });
" 2>/dev/null; then
  pass "atomicWriteFileSync cleans up .tmp orphan on rename failure"
else
  fail "io.cjs orphan-cleanup branch broken"
fi

echo "== security.cjs masking + sanitization =="
# isSecretKey + maskSecrets — known names, suffix-based, and non-secret keys.
if node -e "
  const { isSecretKey, maskSecrets, sanitizeForDisplay } = require('$ROOT/bin/modules/security.cjs');
  // Known-name detection
  if (!isSecretKey('password')) process.exit(1);
  if (!isSecretKey('API_KEY')) process.exit(2);  // case-insensitive
  if (!isSecretKey('db_token')) process.exit(3);  // suffix
  if (isSecretKey('auth_strategy')) process.exit(4);  // contains 'auth' but not suffix-shaped
  // maskSecrets envelope check
  const masked = maskSecrets({ api_key: 'abcd', name: 'public', nested: { db_password: 'pw' } });
  if (masked.api_key !== '***MASKED***') process.exit(5);
  if (masked.name !== 'public') process.exit(6);
  if (masked.nested.db_password !== '***MASKED***') process.exit(7);
  // sanitizeForDisplay strips protocol-like leak markers but preserves normal text
  if (sanitizeForDisplay('<|assistant|>') !== '') process.exit(8);
  if (sanitizeForDisplay('hello world') !== 'hello world') process.exit(9);
" 2>/dev/null; then
  pass "isSecretKey + maskSecrets + sanitizeForDisplay correctness"
else
  fail "security.cjs masking/sanitization failed"
fi

# Cycle guard returns a string sentinel (must stay JSON-serializable) — bug 888 regression test.
if node -e "
  const { maskSecrets } = require('$ROOT/bin/modules/security.cjs');
  const a = { name: 'x' }; a.self = a;
  const out = maskSecrets(a);
  // out.self must be the string sentinel, not the live cyclic object
  if (typeof out.self !== 'string' || out.self !== '[Circular]') process.exit(1);
  // And the whole result must be JSON-serializable (the whole point of the helper).
  JSON.stringify(out);
" 2>/dev/null; then
  pass "maskSecrets cycle guard returns serializable sentinel"
else
  fail "maskSecrets cycle guard regressed (bug 888)"
fi

echo "== workflow_type registry coverage =="
# Mirror of CI lint: every entry in VALID_WORKFLOW_TYPES (state.cjs) must have
# routing in BOTH workflows/next.md and workflows/status.md. Catches drift
# locally before push.
if node -e "
  const { VALID_WORKFLOW_TYPES } = require('$ROOT/bin/modules/state.cjs');
  const fs = require('fs');
  const next = fs.readFileSync('$ROOT/workflows/next.md', 'utf8');
  const status = fs.readFileSync('$ROOT/workflows/status.md', 'utf8');
  const missingNext = [], missingStatus = [];
  for (const t of VALID_WORKFLOW_TYPES) {
    if (t === null) continue;
    if (!next.includes(t)) missingNext.push(t);
    if (!status.includes(t)) missingStatus.push(t);
  }
  if (missingNext.length || missingStatus.length) {
    if (missingNext.length)   process.stderr.write('missing-next: ' + missingNext.join(',') + '\n');
    if (missingStatus.length) process.stderr.write('missing-status: ' + missingStatus.join(',') + '\n');
    process.exit(1);
  }
" 2>/dev/null; then
  pass "every VALID_WORKFLOW_TYPES entry covered in next.md AND status.md"
else
  fail "workflow_type registry drift — missing rows in next.md or status.md"
fi

echo "== autonomous_chain consumer-clear pattern (v0.30.6+) =="
# next.md MUST clear autonomous_chain BEFORE dispatching /devt:ship so a stale
# value from a prior session cannot re-trigger ship inappropriately. ship.md
# MUST also clear at start as a defense-in-depth idempotency safety net for
# direct invocations. Both clears use `state update autonomous_chain=null`.
if grep -qE 'state update autonomous_chain=null' "$ROOT/workflows/next.md"; then
  pass "next.md consumer-clears autonomous_chain before dispatch"
else
  fail "next.md does not clear autonomous_chain before /devt:ship dispatch (D-W0-1)"
fi
if grep -qE 'state update autonomous_chain=null' "$ROOT/workflows/ship.md"; then
  pass "ship.md clears autonomous_chain at start (idempotency safety net)"
else
  fail "ship.md does not clear autonomous_chain at start (D-W0-1)"
fi

echo "== Command description budget =="
# Slash-command descriptions appear in autocomplete and the system prompt's
# command list — every char costs cold-start tokens. 180 chars is enough for
# action verb + 1 trigger-phrase clause; multi-sentence paragraphs belong in
# the command body, not the description field.
DESC_LIMIT=180
DESC_OVER=()
for cmd_file in "$ROOT"/commands/*.md; do
  desc_len=$(awk -F': ' '/^description:/ {sub(/^description: */, ""); print length($0); exit}' "$cmd_file")
  if [ -n "$desc_len" ] && [ "$desc_len" -gt "$DESC_LIMIT" ]; then
    DESC_OVER+=("$(basename "$cmd_file"): ${desc_len} chars")
  fi
done
if [ ${#DESC_OVER[@]} -eq 0 ]; then
  pass "all command descriptions within $DESC_LIMIT-char budget"
else
  for entry in "${DESC_OVER[@]}"; do
    fail "command description over budget — $entry (limit $DESC_LIMIT)"
  done
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
