# Next-Session Plan — Post-v0.62.0 Backlog

> **Created**: 2026-05-28. **Revised**: 2026-05-28 (afternoon) to integrate greenfield calibration findings from `/Users/emrec/Projects/greenfield-api/.devt/state/graphify-implementation-review.md` + the 10-part calibration prompt response. All claims validated against working tree at v0.62.0 + commits `2ef32fb`, `5c6c6bd`, `166f5b5`, `e63c318`, `cd279a8`.
>
> **Discipline**: every task includes a "validate before coding" step. Per [[feedback-validate-before-implement]] and [[feedback-deep-scan-pattern]], do not blindly trust this plan — surface deviations from observed code state before implementing. Validation findings for every claim are recorded inline so future-you can audit the diagnosis without re-running the calibration.

## Backlog grooming summary

| Source | Items reviewed | Kept | Rejected | Deferred | Skipped |
|---|---|---|---|---|---|
| v0.62.0 deferred + greenfield calibration (2026-05-28 morning) | 14 | 11 | 3 | 3 | 2 |
| greenfield calibration #2 (2026-05-28 afternoon, GFBUGS-180 quick-implement) | 12 | 12 | 0 | 4 | 0 |
| **Total** | **26** | **23** | **3** | **7** | **2** |

**Rejected (will not implement)**:
- *Agent passivity around graphify* — conflicts with CLAUDE.md:176 architectural contract ("Agent bodies MUST NOT instruct mcp__*graphify* calls"). Intentional design.
- *Re-dispatch template enforcement* — detecting freeform-vs-template needs new hook infrastructure; L1's "blocks present" check is correct granularity.
- *Per-lane verifiers* — no field signal; speculative. Single consolidated verifier remains correct.

**Deferred (revisit on next field signal)**:
- *AST-based semantic duplicate detection* — defer until v0.61.0's text-based pre-search shows a real miss-rate problem.
- *LLM/embedding-based symbol extraction* (greenfield review #1 highest-ROI item) — too invasive for v0.63.0; needs framework decision (embedding source, latency budget). Phase B unlocks the easy half via denylist + fallback gating; defer the LLM half to v0.65.0+ after field signal on whether the easy half is sufficient.
- *Concept docs `superseded_when` lifecycle field* — defer to v0.64.0; no recurring field pain yet.
- *`memory promote` batches tooling items* — defer to v0.64.0; the curator pre-recommend (Task B3 in current B-III) likely eliminates 80% of the per-candidate friction without batching.
- *`list_prs` / `triage_prs` MCP wiring* — GitHub-only, blocked by Phase C decisions.
- *blast_radius memoization* (greenfield review #6) — premature optimization without field timing data.
- *Move reuse-search to plan stage* (greenfield review #8) — defer until COMPLEX dev-workflow gets field exercise.

**Skipped (not code tasks)**:
- Greenfield testing of v0.62.1/v0.63.0 — user-driven; produces next signal cycle.
- LLM/embedding spike research — separate exploration, not a release task.

## Four-phase plan

Phases sequenced by risk + leverage. Phase A is small + ships quickly; Phase B is medium + addresses the highest field-impact gaps; Phase C is graphify-coverage milestone; Phase D is a research-only spike.

---

## Phase A — Operational + Surgical Hotfixes (v0.62.1) — ✅ SHIPPED 2026-05-28

> **Status**: SHIPPED as v0.62.1. All 11 tasks (A1 through A11) completed. Smoke 679 → 685/0.
>
> **Commits**: a66e2ee (A6 placeholder regex), f839aaf (A7 SYMBOL_DENYLIST), ad87029 (A8 lane-JSON eviction), fe9a284 (A9 verifier gate workflow_type), e92e973 (A2 workflow_dispatch), ad46d80 (A3 release.sh), 7428443 (A4 J2 smoke), cc0143a (A5 INTERNALS.md substance-gates), 0f5b8b5 (A10 mcp-stats docs), 623e536 (A11 v0.62.1 release).
>
> Task bodies below preserved as audit trail. New work continues in Phase B.

**Theme**: clean operational deck + harden release flow + ship the small calibration hotfixes that don't need architectural change.

**Smoke target**: 679 → 685 (J1 INTERNALS.md gate + J2 release-drift gate + K2-K5 hotfix regression fixtures) — **ACHIEVED**.

**Effort**: ~3–4 hours.

**Sequencing note**: A6-A9 are independent 1–5 line code changes; could be batched into a single commit if desired. A2-A5 + A10 are release-flow / docs work that can run in parallel with A6-A9.

### Task A1: Recover 8 missing GitHub Releases — ✅ COMPLETED 2026-05-28

(Unchanged — see git history. Confirmed by greenfield calibration 9a: "v0.62.0 IS the Latest. All of v0.58.0 through v0.62.0 are visible as published releases.")

### Task A2: Add `workflow_dispatch` to release.yml

**Validated finding** (controller, 2026-05-28 morning): `.github/workflows/release.yml` currently has only `on: push: tags: 'v*'`. No manual fallback. If the silent-skip recurs, recovery requires the loop in A1.

**Effort**: ~5 minutes.

- [ ] **Step 1: Read current workflow file**

```bash
head -25 /Users/emrec/Projects/devt/.github/workflows/release.yml
```

- [ ] **Step 2: Add `workflow_dispatch` trigger**

Find:
```yaml
on:
  push:
    tags:
      - 'v*'
```

Replace with:
```yaml
on:
  push:
    tags:
      - 'v*'
  workflow_dispatch:
    inputs:
      tag:
        description: 'Tag to release (e.g. v0.62.0). Must already exist on origin.'
        required: true
        type: string
```

- [ ] **Step 3: Update "Resolve version from tag" step to handle workflow_dispatch input**

Replace:
```yaml
      - name: Resolve version from tag
        id: version
        run: |
          TAG="${GITHUB_REF#refs/tags/}"
          VERSION="${TAG#v}"
```

With:
```yaml
      - name: Resolve version from tag
        id: version
        env:
          INPUT_TAG: ${{ github.event.inputs.tag }}
        run: |
          if [ -n "$INPUT_TAG" ]; then
            TAG="$INPUT_TAG"
          else
            TAG="${GITHUB_REF#refs/tags/}"
          fi
          VERSION="${TAG#v}"
```

Then in the checkout step, add `ref: ${{ github.event.inputs.tag || github.ref }}` so workflow_dispatch checks out the tag, not main.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci(release): add workflow_dispatch trigger as manual fallback (covers silent-skip recurrence)"
```

### Task A3: Release helper script (`scripts/release.sh`)

**Validated finding** (2026-05-28 morning): the v0.58.1→v0.62.0 silent-skip happened because tags got pushed in a single bulk `git push --tags`. Procedural fix — helper script pushes commits + tag separately, uses annotated tags, verifies the GitHub Release was created.

**Effort**: ~30 minutes.

- [ ] **Step 1: Validate** existing release flow + git config

```bash
git -C /Users/emrec/Projects/devt for-each-ref --format='%(refname:short) %(objecttype)' refs/tags | head -10
# Annotated tags show "tag"; lightweight show "commit". The 8 session tags are likely "commit".
```

- [ ] **Step 2: Create `scripts/release.sh`** (see existing plan content; unchanged from prior revision)

- [ ] **Step 3: Make executable + document the helper in CLAUDE.md's Releasing section**

- [ ] **Step 4: Commit**

```bash
git add scripts/release.sh CLAUDE.md
git commit -m "chore(release): scripts/release.sh helper — annotated tag + per-tag push (prevents silent-skip recurrence)"
```

### Task A4: Smoke gate J2 — detect release-tag drift

**Validated finding**: no smoke gate today warns when local tags exist but GitHub Releases don't. The v0.58.1→v0.62.0 drift went unnoticed for hours.

**Effort**: ~15 minutes.

- [ ] **Step 1: Add J2 gate to `scripts/smoke-test.sh`** (see existing plan content; unchanged)

- [ ] **Step 2: Run smoke + commit**

```bash
bash scripts/smoke-test.sh 2>&1 | grep -E "J[12]|Result"
git add scripts/smoke-test.sh
git commit -m "test(smoke): J2 — detect local-tag-vs-GitHub-release drift"
```

### Task A5: Promote CON-001 + update INTERNALS.md to current state

**Validated finding** (controller, 2026-05-28 morning): docs/INTERNALS.md::Substance-Enforcement Gates documents only 5 instances (F4, B4, L1, F26, F27-F28) and only the existence-binding property. Missing 9 instances + the freshness-binding property.

**Effort**: ~30 minutes.

(Unchanged — see existing plan body for the 14-row table content + freshness-binding required-properties subsection + J1 smoke gate.)

### Task A6 (NEW): Drop `\bplaceholder\b` from F31 stub-marker regex

**Validated finding** (greenfield calibration #2, 2026-05-28 afternoon, calibration responses 2b and 2d):
> "F31 stub regex produced FALSE POSITIVES on my finalized artifacts: review.md (897 words) and impl-summary.md (762 words). Match is on legitimate compliance-checklist row 'No TODO / placeholder | ✓'. F31 needs word-context awareness."

**Root-cause diagnosis** (deeper than greenfield's framing):

I read `STUB_MARKER_PATTERNS` at `bin/modules/state.cjs:1495-1510` — 8 regexes. Seven target specific phrase structures ("Stub written", "analysis in progress", "(stub)", line-leading "TODO:"/"WIP:", "not yet written", "stub:"/"stub." prefix). Only `\bplaceholder\b/i` is a bare common-noun match with no phrase context. A genuine "placeholder for the real review" stub would also match the "analysis|implementation|review|work|writing|investigation in progress" pattern OR the "Stub:" prefix pattern, so deleting the bare-noun regex has zero detection cost.

**Effort**: ~5 minutes including the smoke fixture.

- [ ] **Step 1: Read current STUB_MARKER_PATTERNS array**

```bash
sed -n '1495,1510p' /Users/emrec/Projects/devt/bin/modules/state.cjs
```

- [ ] **Step 2: Delete line 1505** (the `/\bplaceholder\b/i,` entry only). All other patterns stay.

- [ ] **Step 3: Add smoke gate K2 — stub-regex regression fixture**

In `scripts/smoke-test.sh`, just before the final result echo:

```bash
# K2: F31 stub-marker regex must not false-positive on legitimate compliance
# checklists. greenfield 2026-05-28 PM: substantive review.md (897 words) was
# flagged because of "No TODO / placeholder | ✓" checklist row. Fixture mimics
# that exact shape.
mkdir -p /tmp/devt-smoke-k2
FIXTURE=/tmp/devt-smoke-k2/compliance-checklist.md
cat >"$FIXTURE" <<'EOF'
# Code Review

## Findings
The implementation is clean. All standards met.

## Compliance Checklist

| Check | Status | Notes |
|---|---|---|
| No TODO / placeholder | ✓ | grep clean for TODO/FIXME/XXX in diff |
| Tests pass | ✓ | full suite green |
| Lint clean | ✓ | no warnings |

## Verdict
APPROVED.
EOF
# Pad to >50 words so word_count threshold isn't the trigger
for i in 1 2 3 4 5; do
  echo "Detailed analysis line $i with substantive prose about correctness." >> "$FIXTURE"
done
K2_OUT=$(node "$ROOT/bin/devt-tools.cjs" state check-agent-output "$FIXTURE" 2>&1)
if echo "$K2_OUT" | grep -q '"looks_like_stub":false'; then
  pass "K2: compliance-checklist with 'placeholder' word in row label does NOT trigger stub-marker false-positive"
else
  fail "K2: substantive review with 'No TODO / placeholder | ✓' row flagged as stub — F31 regex regression. Output: $K2_OUT"
fi
rm -rf /tmp/devt-smoke-k2
```

- [ ] **Step 4: Run smoke + commit**

```bash
bash /Users/emrec/Projects/devt/scripts/smoke-test.sh 2>&1 | grep -E "K2|Result"
# Expected: K2 pass; 680/0
git add bin/modules/state.cjs scripts/smoke-test.sh
git commit -m "fix(state): drop \\bplaceholder\\b from F31 stub regex (false-positive on compliance checklists)"
```

### Task A7 (NEW): Extend SYMBOL_DENYLIST with missing English action verbs

**Validated finding** (greenfield calibration #2, 5c: `topic.symbols | length = 1, single symbol: ["Enrich"]`):

Reading `bin/modules/preflight.cjs:138-173`, SYMBOL_DENYLIST contains 30+ verbs (add, fix, remove, delete, update, change, rename, refactor, implement, build, create, make, extend, improve, optimize, support, introduce, migrate, wire, integrate, polish) but is missing the verbs that appeared in greenfield's task: `enrich, harvest, normalize, validate, deprecate, sunset, ratify, expose, enable, disable, surface, propagate, audit`. The PascalCase regex (line 307) extracted `Enrich` from "Enrich relative-clients picker endpoint…" and it survived all filters — cascading into `direct_dependents=0` and the entire graphify_scan_prep SKIP path.

The denylist is the correct mechanism; it just hasn't kept up with task vocabulary.

**Effort**: ~10 minutes.

- [ ] **Step 1: Read current denylist**

```bash
sed -n '138,173p' /Users/emrec/Projects/devt/bin/modules/preflight.cjs
```

- [ ] **Step 2: Extend the "Action verbs commonly capitalized as task-leading words" block (line 140-142)**

Add to that block:
```javascript
  "enrich", "harvest", "normalize", "validate", "deprecate", "sunset",
  "ratify", "expose", "enable", "disable", "surface", "propagate", "audit",
  "expand", "shrink", "split", "merge", "join", "annotate", "tag", "track",
  "monitor", "observe", "log", "trace", "report",
```

- [ ] **Step 3: Add smoke gate K3 — denylist coverage fixture**

In `scripts/smoke-test.sh`:

```bash
# K3: extractTopic must filter common English verb-prefixes from task text
# so they don't cascade into the graphify_scan_prep SKIP path. greenfield
# 2026-05-28 PM: "Enrich relative-clients picker endpoint with license code…"
# returned topic.symbols=["Enrich"] which masked the snake_case FTS fallback.
K3_OUT=$(node -e '
const p = require("'"$ROOT"'/bin/modules/preflight.cjs");
const t = p.extractTopic("Enrich relative-clients picker endpoint with license code, valid_until, subscription name");
console.log(JSON.stringify(t.symbols));
')
if [ "$K3_OUT" = "[]" ]; then
  pass "K3: extractTopic filters Enrich (English verb) from task-leading position"
else
  fail "K3: extractTopic returned ${K3_OUT}; expected []. Denylist incomplete?"
fi
```

- [ ] **Step 4: Run smoke + commit**

```bash
bash /Users/emrec/Projects/devt/scripts/smoke-test.sh 2>&1 | grep -E "K[23]|Result"
git add bin/modules/preflight.cjs scripts/smoke-test.sh
git commit -m "fix(preflight): extend SYMBOL_DENYLIST with 25 more English action verbs (closes Enrich-blocks-FTS-fallback path)"
```

### Task A8 (NEW): Add `review-lane-*.json` to WORKFLOW_EVICTABLE regex

**Validated finding** (greenfield calibration #2, 1b + 3b notes):
> "state directory still has stale artifacts from prior sessions visible: arch-review.md, plan.md, validated-plan.md, review-lane-c.json — triggered validation_warnings=2."

Reading `bin/modules/state-audit.cjs:313-331` — the lane-file eviction regex matches `^review-lane-[A-Za-z0-9_.-]+\.md$` only. JSON sidecars (e.g., `review-lane-c.json`) are NOT cleared. Greenfield's stale `review-lane-c.json` from a prior workflow persisted across `init review` because of this gap.

`validated-plan.md` and `arch-review.md` are intentionally preserved (plan-phase + arch-health-scan outputs that follow-up workflows consume). Leave those alone.

**Effort**: ~10 minutes.

- [ ] **Step 1: Read current regex**

```bash
sed -n '313,331p' /Users/emrec/Projects/devt/bin/modules/state-audit.cjs
```

- [ ] **Step 2: Extend regex to cover `.json` siblings**

Change line 316 from:
```javascript
if (/^review-lane-[A-Za-z0-9_.-]+\.md$/.test(entry)) {
```

To:
```javascript
if (/^review-lane-[A-Za-z0-9_.-]+\.(md|json)$/.test(entry)) {
```

- [ ] **Step 3: Add smoke gate K4 — JSON-sibling eviction fixture**

```bash
# K4: review-lane-*.json sidecars must be evicted alongside their .md
# counterparts. greenfield 2026-05-28 PM: review-lane-c.json from a prior
# workflow persisted, causing validation_warnings=2 mid-session.
mkdir -p /tmp/devt-smoke-k4/.devt/state
cd /tmp/devt-smoke-k4
echo "stub" > .devt/state/review-lane-a.md
echo "{}" > .devt/state/review-lane-a.json
echo "stub" > .devt/state/review-lane-b.md
echo "{}" > .devt/state/review-lane-b.json
K4_OUT=$(node "$ROOT/bin/devt-tools.cjs" state evict-workflow-artifacts 2>&1)
REMAINING=$(ls .devt/state/ | grep -c "review-lane" || echo 0)
if [ "$REMAINING" = "0" ]; then
  pass "K4: both review-lane-*.md and review-lane-*.json evicted"
else
  fail "K4: ${REMAINING} review-lane files remain after eviction. Output: $K4_OUT"
fi
cd "$ROOT"
rm -rf /tmp/devt-smoke-k4
```

- [ ] **Step 4: Run smoke + commit**

```bash
bash scripts/smoke-test.sh 2>&1 | grep -E "K4|Result"
git add bin/modules/state-audit.cjs scripts/smoke-test.sh
git commit -m "fix(state-audit): evict review-lane-*.json sidecars alongside .md (closes greenfield lane-JSON persistence)"
```

### Task A9 (NEW): Make `assert-verifier-ran` workflow_type-aware

**Validated finding** (greenfield calibration #2, 1c + 6a #2):
> "assert-verifier-ran: ok:false — config.workflow.verification=true but neither verification.json nor verification.md exists. I did NOT notice this gate failed. quick-implement.md doesn't have a verifier step, but the project config expects one and I never noticed the mismatch."

Reading `bin/modules/state.cjs:1575-1626` — the gate reads `cfg.workflow.verification` from `getMergedConfig()` but is `workflow_type`-blind. quick-implement intentionally skips verification (per its command description: "skip docs and retro, go straight to code and tests"). Same for debug, retro, memory_promote, memory_reject, plan, specify, clarify, preflight, research, arch_health_scan. Only `dev`, `code_review`, `code_review_parallel` actually dispatch verifiers when `cfg.workflow.verification=true`.

**Effort**: ~20 minutes.

- [ ] **Step 1: Read current gate**

```bash
sed -n '1575,1626p' /Users/emrec/Projects/devt/bin/modules/state.cjs
```

- [ ] **Step 2: Add VERIFIER_REQUIRED set + short-circuit logic**

After line 1574 (before `function assertVerifierRan()`):

```javascript
// Workflow types that dispatch a verifier when config.workflow.verification=true.
// Other workflow types (quick_implement, debug, retro, plan, specify, etc.)
// intentionally skip verification by design — applying the gate uniformly
// produces false-negative blocks. Validated 2026-05-28 (greenfield calibration #2).
const VERIFIER_REQUIRED_WORKFLOWS = new Set([
  "dev",
  "code_review",
  "code_review_parallel",
]);
```

Then inside `assertVerifierRan()`, after the `verificationEnabled` check (line 1582), insert:

```javascript
  // workflow_type opt-out: only dev / code_review / code_review_parallel
  // dispatch a verifier. Other workflow_types intentionally skip.
  let workflowType = null;
  try {
    const stateData = readState();
    workflowType = stateData && stateData.workflow_type;
  } catch { /* fall through — treat as "unknown, apply gate" */ }
  if (workflowType && !VERIFIER_REQUIRED_WORKFLOWS.has(workflowType)) {
    return {
      ok: true,
      verification_enabled: true,
      workflow_type: workflowType,
      reason: `workflow_type=${workflowType} does not dispatch a verifier by design — gate does not apply`,
    };
  }
```

- [ ] **Step 3: Add smoke gate K5 — verifier-gate workflow-type awareness**

```bash
# K5: assert-verifier-ran must short-circuit for workflow_types that don't
# dispatch a verifier. greenfield 2026-05-28 PM: quick_implement workflow
# tripped the gate because config.workflow.verification=true but quick_implement
# doesn't have a verifier step — false negative.
mkdir -p /tmp/devt-smoke-k5/.devt/state
cd /tmp/devt-smoke-k5
echo '{"workflow":{"verification":true}}' > .devt/config.json
node "$ROOT/bin/devt-tools.cjs" init quick "test task" >/dev/null 2>&1 || true
K5_OUT=$(node "$ROOT/bin/devt-tools.cjs" state assert-verifier-ran 2>&1)
if echo "$K5_OUT" | grep -q '"ok":true'; then
  pass "K5: assert-verifier-ran short-circuits for workflow_type=quick_implement"
else
  fail "K5: assert-verifier-ran did not short-circuit. Output: $K5_OUT"
fi
cd "$ROOT"
rm -rf /tmp/devt-smoke-k5
```

- [ ] **Step 4: Run smoke + commit**

```bash
bash scripts/smoke-test.sh 2>&1 | grep -E "K5|Result"
git add bin/modules/state.cjs scripts/smoke-test.sh
git commit -m "fix(state): assert-verifier-ran short-circuits for workflow_types that skip verification by design"
```

### Task A10 (NEW): Document the mcp-stats CLI-wrapper caveat

**Validated finding** (greenfield calibration #2, 5a + 9c):
> "mcp-stats for this workflow_id: entries_considered: 0. Trace file has 74 lines total, all from older workflows. Every graphify-flavored action went through CLI wrappers (preflight generate, state derive-reuse-candidates if it had fired, state assert-graphify-decision). CLI wrappers don't write to _mcp-trace.jsonl. So mcp-stats is 'correctly empty' but the underlying graphify usage was also empty."

This isn't a bug — it's an undocumented invariant. Sessions that go entirely through CLI wrappers will produce empty `mcp-stats`. The post-v0.60.0 namespace hotfix can't be validated from such a session.

**Effort**: ~10 minutes.

- [ ] **Step 1: Find the MCP Trace section in docs/INTERNALS.md**

```bash
grep -n "MCP Trace\|mcp-stats\|_mcp-trace" /Users/emrec/Projects/devt/docs/INTERNALS.md | head -10
```

- [ ] **Step 2: Add the caveat note**

After the existing description of `_mcp-trace.jsonl`, add:

```markdown
**CLI wrappers do NOT write to `_mcp-trace.jsonl`.** The trace records direct
MCP tool invocations only. Workflows that go entirely through CLI wrappers
(`preflight generate`, `state derive-reuse-candidates`, `state assert-graphify-decision`,
`state evict-graphify`) will produce empty `mcp-stats` output even when graphify
is fully active and load-bearing — the trace is "correctly empty" because no
direct MCP calls occurred. To validate the v0.60.0 namespace hotfix or measure
direct MCP usage, exercise a workflow that dispatches code-reviewer's
symbol_anchored / bulk_scoped / pr_scoped tiers (which DO call `query_graph`,
`get_neighbors`, `blast_radius` directly), or call MCP tools from the orchestrator
during context_init's drill-down protocol.
```

- [ ] **Step 3: Commit**

```bash
git add docs/INTERNALS.md
git commit -m "docs(internals): clarify mcp-stats is empty for CLI-wrapper-only sessions"
```

### Task A11: v0.62.1 release

**Files**: VERSION, plugin.json, CHANGELOG.md

- [ ] Bump VERSION 0.62.0 → 0.62.1, plugin.json to match
- [ ] CHANGELOG `[0.62.1]` section — theme: "operational cleanup + INTERNALS.md substance-gates update + 4 surgical hotfixes"
  - Group entries: `### Fixed` (A6/A7/A8/A9), `### Changed` (A2/A3/A5), `### Documentation` (A5/A10), `### Smoke tests` (J1, J2, K2-K5)
- [ ] Final smoke 679 → ~684 (+J1, +J2, +K2, +K3, +K4, +K5)
- [ ] Commit
- [ ] Tag + push via the new `scripts/release.sh v0.62.1` (validates the helper in the same release that introduces it)

---

## Phase B — Symbol Extraction Unlock + Anti-Escape-Hatch + Memory UX (v0.63.0)

**Theme**: close the three highest-impact field gaps greenfield calibration surfaced — (1) the symbol-extraction bottleneck that cascades into full graphify SKIP, (2) the escape-hatch gate class that silently passes on missing prep artifacts, (3) the memory-candidate surfacing gap that leaves candidates in `_suggestions.md` untouched.

**Smoke target**: ~684 → ~705 (+~20 gates across three sub-batches)

**Effort**: ~12–15 hours across 2–3 sessions.

**Sequencing inside Phase B**: B-I (symbol extraction) is independent of B-II + B-III; can ship in parallel. B-II + B-III are independent of each other but share a release boundary because they're all UX/correctness improvements that don't affect protocol. If shipping incrementally, suggested order: B-I first (highest field impact, smallest blast radius), then B-II (closes silent-skip class), then B-III (UX polish on top of working gates).

---

### Sub-batch B-I — Symbol Extraction Unlock

**Validated finding** (greenfield calibration #2, 5c + full review report §4):
> "topic.symbols=['Enrich']. For 'GFBUGS-180: Enrich relative-clients picker endpoint with license code, valid_until, subscription name…' the high-signal terms are `relative-clients`, `license`, `subscription`, `valid_until`, `picker`. None are PascalCase. None are snake_case (relative-clients is kebab). The regex catches Enrich. The fallback never fires (symbols.length=1). Net: 0 useful symbols, but the system doesn't know."

Reading `bin/modules/preflight.cjs:295-358`, the resolution path is:
1. Source 1: git-diff symbols (high signal, unavailable for fresh tasks)
2. Source 2: PascalCase regex on text (low signal — sentence-leading verbs leak)
3. Source 3 (fallback): snake_case keyword FTS — **only fires when `symbols.length === 0`** (the gating bug)

A7 (Phase A) closes the Enrich-survives-denylist hole. B-I closes the structural cascade.

**Effort**: ~3-4 hours.

#### Task B-I.1 — Loosen FTS-fallback gate

**Change**: line 338 of preflight.cjs from:

```javascript
if (symbols.length === 0 && graphifyQuery) {
```

To:

```javascript
// Field signal (greenfield 2026-05-28): a single noise symbol that
// survives the denylist (e.g., "Enrich" pre-A7) blocks the FTS rescue
// path entirely. Run the fallback ALSO when surviving symbols are all
// short (likely PascalCase noise rather than meaningful identifiers).
const allShortSymbols = symbols.length > 0 && symbols.every(s => s.length <= 6);
if ((symbols.length === 0 || allShortSymbols) && graphifyQuery) {
```

- [ ] **Validate**: confirm with the A7 fixture ("Enrich relative-clients picker…") that the fallback now fires and resolves `valid_until` → graph nodes.
- [ ] **Smoke gate K6**: extractTopic with `{graphifyQuery: stubResolver}` on the fixture returns symbols beyond just "Enrich" (or post-A7, beyond empty).

#### Task B-I.2 — Add kebab-case extraction pattern

**Change**: in the FTS fallback block (preflight.cjs:339-341), extend the candidate regex to cover BOTH snake and kebab:

```javascript
const candidates = Array.from(new Set(
  words.filter(w =>
    (/^[a-z][a-z0-9]+(_[a-z0-9]+)+$/.test(w) ||      // snake_case
     /^[a-z][a-z0-9]+(-[a-z0-9]+)+$/.test(w))        // kebab-case
    && !STOP_WORDS.has(w))
)).slice(0, 3);
```

Note: the `words` extraction at line 320 already uses `/[a-z][a-z0-9_-]{1,30}/g` so kebab tokens are preserved through to this point. Just extend the predicate.

- [ ] **Validate**: confirm `words` regex captures `relative-clients` (it does per line 320's `[a-z0-9_-]` character class).
- [ ] **Smoke gate K7**: extractTopic on "Enrich relative-clients picker" with graphifyQuery returning a hit for "relative-clients" surfaces it as a symbol.

#### Task B-I.3 — Full-text FTS terminal fallback

**Change**: when keyword-by-keyword FTS returns 0 candidates resolved to graph nodes AND graph is dense, run one more FTS pass on the FULL task text:

After the snake/kebab fallback loop (around preflight.cjs:355, before `return`):

```javascript
// Terminal fallback: if snake/kebab keyword FTS yielded nothing AND graph
// is dense, run a single FTS pass on the full task text. Catches domain
// nouns ("license", "subscription", "picker") that aren't snake/kebab.
// Cap result merge at 5 to avoid polluting scope_hint with weak matches.
if (symbols.length === 0 && graphifyQuery) {
  let r;
  try { r = graphifyQuery(text, { limit: 5 }); } catch { r = null; }
  if (r && Array.isArray(r.results)) {
    for (const node of r.results.slice(0, 5)) {
      const label = (node && (node.label || node.id)) || null;
      if (!label) continue;
      if (!seen.has(label) && !SYMBOL_DENYLIST.has(label.toLowerCase()) && !isAllCapsNoise(label)) {
        seen.add(label);
        symbols.push(label);
      }
    }
  }
}
```

- [ ] **Validate**: with all symbols filtered out AND graph fresh dense, the full-text fallback runs once.
- [ ] **Smoke gate K8**: extractTopic with a noun-heavy task ("Add license subscription picker endpoint") + graphifyQuery returning matches resolves at least one symbol.

#### Task B-I.4 — `symbol_resolution_path` telemetry

**Change**: extend the `extractTopic` return shape with a `resolution_path` field that records which source produced the final symbols:

```javascript
return {
  domains,
  symbols,
  keywords,
  raw: text,
  resolution_path: <"diff" | "text" | "snake_fts" | "kebab_fts" | "full_text_fts" | "none">,
};
```

Wire it into `preflight-brief.json` so future calibrations can measure fallback effectiveness without instrumentation.

- [ ] **Validate**: read `preflight.cjs::renderPreflightSidecar` to confirm where it serializes topic data.
- [ ] **Smoke gate K9**: preflight-brief.json contains `topic.resolution_path` field with one of the enum values.

#### B-I commit

```bash
git add bin/modules/preflight.cjs scripts/smoke-test.sh
git commit -m "feat(preflight): symbol extraction unlock — kebab support + full-text FTS terminal fallback + resolution_path telemetry"
```

---

### Sub-batch B-II — Anti-Escape-Hatch Gate Strictening

**Validated finding** (greenfield calibration #2, bottom line):
> "The workflow's mechanical gates DID hold, but they're too easy to satisfy with escape-hatch artifacts (claude-mem-skipped.txt, reuse-candidates.md absent → gate doesn't apply). The gates are guarding against egregious skips, not against shallow-completion patterns."

Three silent skips in one session, all sharing the same structural signature:

| Gate | Escape vector | Greenfield observation |
|---|---|---|
| `assert-reuse-analyzed` | `reuse-candidates.md` absent → gate returns ok:true | "v0.61.0 reuse-search feature ran zero times in this workflow. The programmer made no formal reuse analysis." |
| `assert-claude-mem-harvest` | One-line `claude-mem-skipped.txt` satisfies the gate | "wrote a one-line skip reason instead of actually running claude-mem MCP search. Lazy escape that satisfies the gate but produces no value." |
| (none) `KNOWLEDGE-CANDIDATE` tagging | Prose at quick-implement.md:281 says "load-bearing" but no `assert-*` enforces it | "grep -c '#KNOWLEDGE-CANDIDATE' scratchpad.md returns 0. I described 4 candidates in prose. The candidates I noted in prose will NEVER reach the curator. Hard miss." |

**Effort**: ~3-4 hours.

#### Task B-II.1 — `reuse-search-attempted.txt` marker

**Validated finding** (greenfield calibration #2, 4a-4e):
> ".devt/state/reuse-candidates.md does not exist. The workflow's implement step has a bash block calling state derive-reuse-candidates — I either skipped that block entirely or it ran silently. assert-reuse-analyzed returns ok:true with reason 'reuse-candidates.md absent — derive-reuse-candidates was not run; gate does not apply'."

Read `bin/modules/reuse-search.cjs:139-140` — `deriveReuseCandidates` ALWAYS writes the file. So absence ⇒ the workflow bash block didn't run at all. The fix gives the gate a way to distinguish "ran with 0 candidates" (legit no-op, file present with `0 candidates` header) from "never ran" (file absent because bash block was skipped).

**Design**: workflow writes a `reuse-search-attempted.txt` marker BEFORE invoking the CLI. Gate checks marker presence:
- Marker absent → workflow skipped the step (BLOCK with "orchestrator must run derive-reuse-candidates before implement step")
- Marker present + candidates.md absent → CLI failed (BLOCK with CLI failure context)
- Marker present + candidates.md with 0 candidates → legit no-op (PASS with "0 candidates — graphify unavailable or task has no resolvable symbols")
- Marker present + candidates.md with N candidates → require reuse-analysis.md (existing logic, unchanged)

- [ ] **Step 1: Validate**: read `workflows/quick-implement.md:226-232` (the implement-step bash block).
- [ ] **Step 2: Update implement-step bash** in quick-implement.md + dev-workflow.md to write the marker first:

```bash
echo "attempted_at=$(date -u +%FT%TZ)" > .devt/state/reuse-search-attempted.txt
echo "task=${TASK_TEXT}" >> .devt/state/reuse-search-attempted.txt
REUSE_RESULT=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state derive-reuse-candidates "$TASK_TEXT" 2>/dev/null || echo '{"ok":false,"error":"cli_failed"}')
echo "result=$REUSE_RESULT" >> .devt/state/reuse-search-attempted.txt
```

- [ ] **Step 3: Update `assertReuseAnalyzed` in state.cjs:1777**:

```javascript
function assertReuseAnalyzed() {
  const dir = getStateDir();
  const markerPath = path.join(dir, "reuse-search-attempted.txt");
  const candidatesPath = path.join(dir, "reuse-candidates.md");
  const analysisPath = path.join(dir, "reuse-analysis.md");
  const haveMarker = fs.existsSync(markerPath);
  const haveCandidates = fs.existsSync(candidatesPath);

  if (!haveMarker) {
    return {
      ok: false,
      reason:
        "reuse-search-attempted.txt absent — workflow skipped the reuse pre-search step. " +
        "Orchestrator must run `state derive-reuse-candidates \"<task>\"` from the implement-step bash block.",
    };
  }
  if (!haveCandidates) {
    return {
      ok: false,
      marker_present: true,
      reason:
        "reuse-search-attempted.txt present but reuse-candidates.md absent — derive-reuse-candidates CLI failed. " +
        "Check the result= line in the marker file for failure context.",
    };
  }
  // ... rest of existing logic (candidate count parsing, reuse-analysis check, freshness) unchanged
}
```

- [ ] **Step 4: Add `reuse-search-attempted.txt` to WORKFLOW_EVICTABLE** in `state-audit.cjs:265-278` so it gets cleared on init.
- [ ] **Step 5: Smoke gate K10**: marker absent + candidates absent → gate returns ok:false (BLOCK). Marker present + candidates absent → gate returns ok:false with CLI failure reason. Marker present + candidates with 0 entries → gate returns ok:true.

#### Task B-II.2 — Require structured payload in `claude-mem-skipped.txt`

**Validated finding** (greenfield calibration #2, 6b #3):
> "claude-mem MCP harvest is optional, just write the skipped.txt — wrote a one-line skip reason instead of actually running mcp__plugin_claude-mem_mcp-search__search. Lazy escape that satisfies the gate but produces no value."

Read `bin/modules/state.cjs:2043-2086` — `assertClaudeMemHarvest` accepts either `claude-mem-harvest.md` OR `claude-mem-skipped.txt` with no payload validation. The fix: require a structured `reason=<enum>` line in the skip file. Reject one-liners or free-form text.

**Design**: valid reasons:
- `not_installed` — claude-mem plugin not present
- `mcp_unavailable` — plugin present but MCP server not responding
- `corpus_empty` — claude-mem has no observations for this project
- `task_unrelated_to_history` — explicit orchestrator decision (rare; requires `details=<text>` line)

- [ ] **Step 1: Update `assertClaudeMemHarvest`** to validate `claude-mem-skipped.txt` content:

```javascript
if (haveSkipped) {
  const skipContent = fs.readFileSync(skippedPath, "utf8");
  const reasonMatch = skipContent.match(/^reason=([a-z_]+)$/m);
  const validReasons = new Set([
    "not_installed", "mcp_unavailable", "corpus_empty", "task_unrelated_to_history",
  ]);
  if (!reasonMatch || !validReasons.has(reasonMatch[1])) {
    return {
      ok: false,
      file: "claude-mem-skipped.txt",
      reason:
        "claude-mem-skipped.txt missing valid reason= line. Required format: " +
        "reason=<not_installed|mcp_unavailable|corpus_empty|task_unrelated_to_history>. " +
        "For task_unrelated_to_history, also include details=<explanation>.",
    };
  }
  if (reasonMatch[1] === "task_unrelated_to_history" && !/^details=/m.test(skipContent)) {
    return {
      ok: false,
      file: "claude-mem-skipped.txt",
      reason: "reason=task_unrelated_to_history requires a details= line explaining the orchestrator's reasoning.",
    };
  }
}
```

- [ ] **Step 2: Update workflow prose** (context_init steps in all 4 workflows) — when the orchestrator decides to skip claude-mem, the bash must write the structured form:

```bash
cat > .devt/state/claude-mem-skipped.txt <<EOF
reason=mcp_unavailable
attempted_at=$(date -u +%FT%TZ)
EOF
```

- [ ] **Step 3: Smoke gate K11**: one-liner skip file → BLOCK; valid structured payload → PASS; `task_unrelated_to_history` without details → BLOCK.

#### Task B-II.3 — New `assertKnowledgeCandidatesTagged()` gate

**Validated finding** (greenfield calibration #2, 6a #1 + 6e):
> "grep -c '#KNOWLEDGE-CANDIDATE' .devt/state/scratchpad.md returns 0. I described 4 candidates in prose inside review.md ('Knowledge candidates surfaced') but never appended the magic-string #KNOWLEDGE-CANDIDATE lines to scratchpad.md. The candidates I noted in prose will NEVER reach the curator. Hard miss."

Read `workflows/quick-implement.md:281` — prose says "load-bearing — not optional, do this BEFORE writing impl-summary.md" but no `assert-*` enforces it.

**Design**: new CLI subcommand `state assert-knowledge-candidates-tagged`. Runs in `present_findings` step of all 5 task-producing workflows (quick-implement, code-review, code-review-parallel, dev-workflow, debug). Checks scratchpad.md for ≥1 `#KNOWLEDGE-CANDIDATE:` line, OR a `.devt/state/knowledge-candidates-none.txt` artifact with structured payload.

Valid `knowledge-candidates-none.txt` reasons:
- `task_too_routine` — pure CRUD / well-trodden patterns
- `no_novel_patterns` — implementation followed existing conventions exactly
- `all_subsumed_by_existing_memory` — every interesting pattern already exists in `.devt/memory/`

- [ ] **Step 1: Implement `assertKnowledgeCandidatesTagged()`** in state.cjs:

```javascript
function assertKnowledgeCandidatesTagged() {
  const dir = getStateDir();
  const scratchpadPath = path.join(dir, "scratchpad.md");
  const nonePath = path.join(dir, "knowledge-candidates-none.txt");

  const haveNone = fs.existsSync(nonePath);
  if (haveNone) {
    const content = fs.readFileSync(nonePath, "utf8");
    const reasonMatch = content.match(/^reason=([a-z_]+)$/m);
    const validReasons = new Set([
      "task_too_routine", "no_novel_patterns", "all_subsumed_by_existing_memory",
    ]);
    if (!reasonMatch || !validReasons.has(reasonMatch[1])) {
      return {
        ok: false,
        reason:
          "knowledge-candidates-none.txt missing valid reason= line. Required format: " +
          "reason=<task_too_routine|no_novel_patterns|all_subsumed_by_existing_memory>.",
      };
    }
    const freshness = isArtifactFresh(nonePath);
    if (!freshness.fresh) {
      return { ok: false, reason: `${freshness.reason} — knowledge-candidates-none.txt is stale; re-evaluate for this workflow.` };
    }
    return { ok: true, none_declared: true, reason: `explicit none with reason=${reasonMatch[1]}` };
  }

  if (!fs.existsSync(scratchpadPath)) {
    return {
      ok: false,
      reason: "scratchpad.md absent AND knowledge-candidates-none.txt absent — orchestrator did not surface candidates or declare none.",
    };
  }
  const content = fs.readFileSync(scratchpadPath, "utf8");
  const tags = (content.match(/^#KNOWLEDGE-CANDIDATE:/gm) || []).length;
  if (tags === 0) {
    return {
      ok: false,
      tag_count: 0,
      reason:
        "scratchpad.md present but contains 0 #KNOWLEDGE-CANDIDATE lines. " +
        "Orchestrator must tag candidates during work OR write knowledge-candidates-none.txt with a structured reason.",
    };
  }
  return { ok: true, tag_count: tags };
}
```

- [ ] **Step 2: Wire into `present_findings` step** of quick-implement.md, code-review.md, code-review-parallel.md, dev-workflow.md, debug.md as a hard gate (BLOCK on `ok:false`).
- [ ] **Step 3: Add `knowledge-candidates-none.txt` to WORKFLOW_EVICTABLE**.
- [ ] **Step 4: Smoke gate K12**: scratchpad with ≥1 tag → PASS; scratchpad with 0 tags + no `none.txt` → BLOCK; valid `none.txt` → PASS; malformed `none.txt` → BLOCK.

#### Task B-II.4 — Knowledge-candidate aggregation for parallel workflows

**Validated finding** (from current plan's B1 — preserved here because it's complementary to B-II.3 for parallel flows):

For parallel workflows (`code-review-parallel`), lane agents append `#KNOWLEDGE-CANDIDATE` lines to their lane output files (`.devt/state/review-lane-*.md`), not to scratchpad. The orchestrator's consolidate step must aggregate them or B-II.3's gate will false-block parallel reviews.

- [ ] **Step 1: Validate**: confirm exactly where lane agents are instructed to write the tags today (lane file vs scratchpad). Currently they should write to scratchpad per the agent body, but field signal suggests this is inconsistent.
- [ ] **Step 2: Add `state aggregate-knowledge-candidates` CLI** that scans `review-lane-*.md` + `review.md` for `#KNOWLEDGE-CANDIDATE:` lines, dedupes by content, appends to scratchpad.md with `<!-- aggregated from review-lane-X.md -->` provenance comment.
- [ ] **Step 3: Wire the aggregator** into code-review-parallel.md's consolidate step (after consolidator-ran marker, before present_findings).
- [ ] **Step 4: Smoke gate K13**: aggregator pulls tags from 2 lane files into scratchpad with provenance comments.

#### B-II commit batch

Two commits for clarity:

```bash
# Commit 1: state.cjs gate work
git add bin/modules/state.cjs bin/modules/state-audit.cjs
git commit -m "feat(state): anti-escape-hatch gate strictening — reuse-attempted marker + structured skip payloads + knowledge-candidates gate"

# Commit 2: workflow + CLI wiring
git add bin/devt-tools.cjs workflows/*.md
git commit -m "feat(workflow): wire reuse-attempted + claude-mem-structured-skip + knowledge-candidates aggregation into context_init/present_findings"
```

---

### Sub-batch B-III — Memory Layer UX (greenfield-validated priorities)

Greenfield calibration #2 #10 explicitly ranked the previous B0-B5 list. **Adopt greenfield's ranking**:
- #1 field impact: B0 (passive memory-candidate surfacing) → ship in v0.63.0
- #2 field impact: B3 (curator pre-recommends `candidate` status for tooling items) → ship in v0.63.0
- Lower impact: B2 (context_init prose simplification) → ship in v0.63.0 but **scope to code-review.md only** (greenfield observation: 189 lines, not quick-implement's 122)
- Defer: B1 (knowledge-candidate aggregation) → merged into B-II.4 above
- Defer: B4 (`superseded_when`) → v0.64.0+, no recurring field pain yet
- Defer: B5 (memory promote batches) → v0.64.0+, B3 likely eliminates 80% of the friction

**Effort**: ~5-6 hours.

#### Task B-III.1 — Passive memory-candidate surfacing at three natural moments

(Content unchanged from existing plan's B0a-B0e. Renumber to B-III.1.a through B-III.1.e. See lines 391-456 of the prior plan version.)

Three surfaces:
- **B-III.1.a** SessionStart hint via `additionalContext`, gated on count ≥ threshold + no active workflow + cooldown
- **B-III.1.b** `/devt:next` recommendation when `state.active=false`
- **B-III.1.c** `present_findings` footer (4 workflows KEEP-IN-SYNC)
- **B-III.1.d** Config schema: `candidates_surface_threshold: 5`, `candidates_surface_cooldown_hours: 24`
- **B-III.1.e** Single commit

(Detailed steps unchanged — see existing plan body. Validation steps + smoke gates preserved.)

#### Task B-III.2 — Curator pre-recommends `candidate` status for tooling-evolving items

(Content unchanged from existing plan's B3. Renumber to B-III.2.)

**Validated finding** (2026-05-28 morning + afternoon calibration #7c-7d confirmation):
> "Tooling-related candidates from THIS session (Hurl scalar predicate behavior, CONCURRENTLY migration pattern) should likely auto-route to candidate status rather than asking — they're descriptive, not opinionated."

(Detailed steps unchanged — see existing plan body.)

#### Task B-III.3 — `context_init` prose simplification (scope: code-review.md only)

**Refined scope** (greenfield calibration #2, 6c):
> "context_init is still 188+ lines in v0.62.0 with 5 nested bash conditionals…"

I validated against the actual files:
- `workflows/quick-implement.md::context_init` = **122 lines** (long but tractable; defer)
- `workflows/code-review.md::context_init` = **189 lines** (matches greenfield's complaint; in scope)
- `workflows/dev-workflow.md::context_init` = need to measure (likely similar to code-review per existing plan estimate of 180 lines)

**Effort**: ~2-3 hours (just code-review.md + dev-workflow.md, NOT quick-implement.md).

- [ ] **Step 1: Validate** by re-measuring context_init lengths in all 3 dispatch-heavy workflows.
- [ ] **Step 2: Identify natural sub-step boundaries**: init / compute memory_signal / compute scope_hint + scope_trust / evict graphify / compute impact-plan / execute graphify call / F16 drill-down / claude-mem harvest / assert decision artifacts.
- [ ] **Step 3: Split into ~8 named `<substep>` blocks** with one bash + one gate-assert each.
- [ ] **Step 4: Apply KEEP-IN-SYNC across code-review.md, code-review-parallel.md, dev-workflow.md**.
- [ ] **Step 5: Smoke gate K14**: count `<substep>` markers in each affected workflow; gate fails if fewer than 8.

#### B-III commit batch

```bash
# Commit 1: memory surfacing (B-III.1)
git add hooks/session-start.sh workflows/next.md workflows/*.md bin/modules/config.cjs scripts/smoke-test.sh
git commit -m "feat(memory): passive candidate surfacing at 3 natural moments (SessionStart + /devt:next + present_findings footer)"

# Commit 2: curator pre-recommend (B-III.2)
git add agents/curator.md scripts/smoke-test.sh
git commit -m "feat(curator): pre-recommend candidate status for tooling-evolving items + surface backlog backref"

# Commit 3: context_init simplification (B-III.3)
git add workflows/code-review.md workflows/code-review-parallel.md workflows/dev-workflow.md scripts/smoke-test.sh
git commit -m "refactor(workflows): split context_init into named substeps (code-review + dev-workflow only)"
```

---

### Task B-Z: v0.63.0 release

**Files**: VERSION, plugin.json, CHANGELOG.md

- [ ] Bump VERSION 0.62.1 → 0.63.0, plugin.json to match
- [ ] CHANGELOG `[0.63.0]` section — theme: "symbol-extraction unlock + anti-escape-hatch gate hardening + memory UX surfacing"
  - `### Added`: B-I.3 (full-text FTS fallback), B-I.4 (resolution_path telemetry), B-II.3 (knowledge-candidates gate), B-II.4 (aggregator CLI), B-III.1 (3 passive surfaces), B-III.2 (curator pre-recommend), config keys
  - `### Changed`: B-I.1 + B-I.2 (FTS fallback gate + kebab support), B-II.1 (reuse-attempted marker), B-II.2 (structured skip payload), B-III.3 (context_init refactor)
  - `### Smoke tests`: K6-K14
- [ ] Final smoke ~684 → ~705 (+~21 gates)
- [ ] Tag + push via `scripts/release.sh v0.63.0`

---

## Phase C — MCP Wiring Gaps + Bitbucket PR Tier (v0.64.0)

**Theme**: close the graphify-coverage gaps greenfield's review report ranked #3-5, plus the Bitbucket PR tier that's blocking every greenfield-api PR review.

**Smoke target**: ~705 → ~715 (+~10 gates)

**Effort**: ~10-12 hours (own milestone).

**Sequencing inside Phase C**: C-I (MCP wiring) and C-II (Bitbucket PR tier) are independent. C-III (threshold tuning) is small + can ride on either. Suggested: C-I first (smaller, validates MCP integration patterns before adding new tier), then C-II.

---

### Sub-batch C-I — MCP Wiring Gaps

**Validated finding** (greenfield review report §5 + §7):
> "5 of 10 graphify MCP tools never called in agentic flows: shortest_path, get_community, get_node, list_prs, triage_prs."

I confirmed via grep: `get_node` is wrapped at `graphify.cjs:448`, `get_community` at `graphify.cjs:945`. Both have CLI/internal wrappers but are not consumed in any workflow or agent. `shortest_path` is wrapped but never called. `list_prs` + `triage_prs` are GitHub-only (deferred — Phase D candidate).

#### Task C-I.1 — Wire `god_nodes` as structured `<god_node_warnings>` block

**Validated finding** (greenfield review report #3):
> "Today god_nodes lands in the markdown brief but isn't wired into the agent dispatch context as a STRUCTURED hint ('you're about to edit X — it has 417 callers')."

- [ ] **Validate**: read `preflight.cjs::renderPreflightSidecar` to confirm where god_node_match is computed; read existing agent dispatch templates in workflows/.
- [ ] **Implement**: in workflow `<context>` blocks (programmer + code-reviewer + architect dispatches), add `<god_node_warnings>{json from preflight-brief.json::god_node_match}</god_node_warnings>` between `<scope_hint>` and `<scope_trust>` blocks. When god_node_match=true, the agent sees structured warning instead of having to parse the brief markdown.
- [ ] **Smoke gate L1**: dispatching programmer when preflight-brief.json has `god_node_match=true` for some file in scope produces a `<god_node_warnings>` block with `match_count`, `top_callers[]`, etc.

#### Task C-I.2 — Wire `shortest_path` for COMPLEX-tier architect

**Validated finding** (greenfield review report #4):
> "When the architect identifies a service boundary cross, call shortest_path(modified_symbol, other_service_entry_point) to validate ownership. Currently never used."

- [ ] **Validate**: confirm `shortest_path` is exported from `bin/modules/graphify.cjs` and accessible via CLI wrapper.
- [ ] **Implement**: in `workflows/dev-workflow.md::architect` step, when the architect output mentions service-boundary cross, orchestrator runs `state graphify-shortest-path <sym1> <sym2>` (new CLI wrapper) and feeds the result into the verifier dispatch as `<cross_service_paths>` block.
- [ ] **Smoke gate L2**: shortest_path CLI wrapper returns sensible output on a known cross-service symbol pair.

#### Task C-I.3 — Wire `get_community` for parallel-review partitioning

**Validated finding** (greenfield review report #7):
> "Today code-review-parallel partitions by directory prefix (CHANGELOG calls out that community-based partitioning 'never worked'). With proper community resolution via get_community, partition by graph-community could be re-enabled and outperform path-based."

- [ ] **Validate**: read `workflows/code-review-parallel.md::partition_lanes`; understand the current directory-prefix logic + the prior "community-based never worked" failure mode.
- [ ] **Spike-first**: write a 30-line node script that calls `get_community` on a sample diff and prints proposed partitions. Eyeball results before committing to implementation.
- [ ] **Implement** (conditional on spike): replace the directory-prefix partition step with `get_community`-driven partition. Keep directory-prefix as graceful-degradation fallback when graphify=disabled.
- [ ] **Smoke gate L3**: partition output for a 3-community diff produces 3 lanes; partition output for a graphify-disabled scenario falls back to directory prefixes.

#### Task C-I.4 — Wire `get_node` for review.md per-finding context

**Validated finding** (own analysis — greenfield didn't explicitly request this but it complements C-I.1):

When code-reviewer flags a finding tied to a specific symbol, the review.md could carry `get_node`-derived metadata (declaration site, doc strings, type hints) inline. Currently the reviewer has to read the file again to look these up.

- [ ] **Validate**: read code-reviewer agent body for finding-emission format.
- [ ] **Defer decision**: this is greenfield review report's #3 god_nodes-flavored idea but for ad-hoc finding context. Lower priority than C-I.1 — could defer to v0.64.1 if Phase C runs long.

#### C-I commit batch

```bash
# Commit 1: god_nodes structured warnings
git add workflows/*.md scripts/smoke-test.sh
git commit -m "feat(workflow): wire god_nodes as <god_node_warnings> structured block in agent dispatch context"

# Commit 2: shortest_path for cross-service verification
git add bin/devt-tools.cjs bin/modules/state.cjs workflows/dev-workflow.md scripts/smoke-test.sh
git commit -m "feat(graphify): wire shortest_path in COMPLEX-tier architect step for cross-service ownership verification"

# Commit 3: get_community partitioning (conditional on spike)
git add workflows/code-review-parallel.md scripts/smoke-test.sh
git commit -m "feat(graphify): replace directory-prefix partition with get_community-driven for parallel review"
```

---

### Sub-batch C-II — Bitbucket PR-Scoped Tier

**Theme**: graphify's biggest project-leverage gap for non-GitHub repos.

(Content unchanged from existing plan's Phase C. See lines 549-585 of the prior plan version for task bodies C1-C5.)

**Validated finding** (greenfield orchestrator's P0): code-review.md:152-156 routes Bitbucket projects to `symbol_anchored` because `pr_scoped` requires `git.provider=github`. Every greenfield-api review since 2026-05-19 has hit the fallback.

**Effort**: ~6-8 hours.

(Tasks C-II.1 through C-II.5 — unchanged from prior C1-C5; see existing plan body.)

---

### Sub-batch C-III — Threshold Tuning + Memoization

**Validated finding** (greenfield review report #5 + #6 — lower priority but real):

#### Task C-III.1 — Adaptive `direct_dependents` threshold

> "Lower the direct_dependents >= 10 AND trust=dense threshold OR make it adaptive. For a 45K-node graph, 10 is high; many real edits touch 3-9 dependents that would benefit from a blast map."

- [ ] **Validate**: confirm the threshold lives in `workflows/quick-implement.md` + `dev-workflow.md` step `graphify_scan_prep`. Read the actual bash conditional.
- [ ] **Design**: scale threshold by graph size — `max(5, log10(node_count) * 2)` (≈5 for small graphs, ≈10 for 100K-node graphs).
- [ ] **Implement**: extract the threshold computation into a helper function (likely in graphify.cjs or preflight.cjs), used by both workflows. Workflows just consume the resolved value.
- [ ] **Smoke gate L4**: threshold helper returns ≥5 for small graphs, ≤15 for large graphs.

#### Task C-III.2 — `mcp-stats` direct-MCP validation pass

**Validated finding** (greenfield calibration #2, 9c):
> "Cannot validate post-v0.60.0 namespace hotfix from this session's data. Would need to run a session with explicit graphify MCP calls to confirm namespace hotfix."

Not a code task — but a deliberate calibration in a dev-workflow run with explicit MCP drill-downs would close the validation gap. **Owner**: user, not the plan. Track here so it's not lost.

- [ ] Run `/devt:workflow "implement <feature> with symbol-anchored review"` against a multi-symbol diff that exercises the code-reviewer drill-down protocol.
- [ ] Confirm `mcp-stats` returns non-empty for the resulting workflow_id.

### Task C-Z: v0.64.0 release

(Standard bump; CHANGELOG `[0.64.0]` section.)

---

## Phase D — Agent Truncation Recovery (research spike)

**Theme**: investigate the biggest field pain point greenfield's session-2 calibration surfaced.

**Validated finding** (greenfield calibration #2, 6b + 8e):
> "3 of 4 dispatches truncated mid-run. The workflow has no documented recovery protocol. The proper recovery should be SendMessage to the truncated agent's ID, but that's not in the workflow prose. Improvised 'validate-on-disk-then-write-summary-myself' silently degrades the workflow's value (review.md becomes orchestrator-authored, not reviewer-authored)."

**Status**: research spike, not implementation. The fix shape is unknown until we understand the failure modes.

**Effort**: ~1 hour spike → fix shape decision → TBD implementation.

### Task D-1 — Truncation forensics

- [ ] Run `/devt:forensics` on greenfield's 3 truncated dispatches (programmer agent `a28840e8c54223a78`, code-reviewer agent `a45b60838b54a1d26`, tester agent — extract IDs from greenfield's session log).
- [ ] Identify common failure mode signature: which agent? which dispatch length? which scope size? was the prior output viable as continuation context?
- [ ] Document findings in `.devt/state/D1-truncation-forensics.md`.

### Task D-2 — Fix shape decision

Based on D-1, choose between:

**Option D-2.a**: Document SendMessage-to-agent-id recovery in canonical dispatch template (light prose change, ~30min)
**Option D-2.b**: Build `state continue-agent <artifact>` CLI that re-dispatches with partial output as continuation context (heavier; ~3-4h)
**Option D-2.c**: Detect truncation via output substance check (run `check-agent-output` post-dispatch; if `looks_like_stub=true` AND agent dispatch terminated abruptly, trigger automatic re-dispatch with continuation context). Heaviest; ~5-6h.

Pick after D-1.

### Task D-3 — Implementation

TBD per D-2 decision. Could go in v0.63.1 (if D-2.a) or v0.64.0 (if D-2.b) or v0.65.0 (if D-2.c).

---

## Sequencing recommendation

| Session | Work | Effort | Output |
|---|---|---|---|
| Today (afternoon, after this plan revision) | Phase A: A6, A7, A8, A9 (the 4 surgical hotfixes) | ~1.5h | v0.62.1 hotfix subset shipped to main, no release yet |
| Next session | Phase A remainder: A2, A3, A4, A5, A10, A11 release | ~2h | v0.62.1 tagged + released |
| Session 3 | Phase B-I (symbol extraction) | ~3-4h | B-I shipped to main (4 new smoke gates) |
| Session 4 | Phase B-II (anti-escape-hatch) | ~3-4h | B-II shipped to main (4 new smoke gates) |
| Session 5 | Phase B-III (memory UX) + B-Z release | ~5-6h | v0.63.0 tagged + released |
| Session 6+ | Phase C (MCP + Bitbucket) | ~10-12h | v0.64.0 milestone |
| Spike (parallel) | Phase D-1 forensics | ~1h | D-2 decision; D-3 effort scoped |

**Do not bundle Phase B with Phase C.** Different risk profiles, different release boundaries.

**Do not bundle Phase A hotfixes with Phase B unlock work.** Hotfixes ship fast as v0.62.1; Phase B is a 12-15h effort that needs the full release cycle of CHANGELOG + smoke + tag + verify.

## Out of scope (will not implement; will not re-evaluate without new field signal)

- Agent passivity around graphify — architectural contract requires this stays.
- Re-dispatch template enforcement — L1's existence check is correct granularity.
- Per-lane verifiers — speculative, no field signal.
- LLM/embedding-based symbol extraction (greenfield review #1 highest-ROI) — deferred to v0.65.0+ pending Phase B's easy-half results.
- Knowledge-candidate aggregation as a standalone task — merged into B-II.4.
- `superseded_when` concept lifecycle field — defer to v0.64.0+.
- `memory promote` batches tooling items — defer to v0.64.0+; B-III.2 likely subsumes 80%.
- `list_prs` / `triage_prs` MCP wiring — GitHub-only, deferred with Bitbucket Phase C.
- `blast_radius` memoization — premature without field timing data.
- Move reuse-search to plan stage — defer until COMPLEX dev-workflow gets field exercise.

## Why this plan

- **Validation-first**: every kept item has explicit codebase evidence (file:line citations) OR field-signal evidence (calibration response numbers). Every rejection or defer has documented reason.
- **No speculative work**: every implemented item traces to specific calibration signal or operational evidence from this session or greenfield's 2026-05-28 sessions.
- **Phased by risk + leverage**: surgical hotfixes first (Phase A, low risk), architectural unlocks second (Phase B, medium risk, highest field impact), coverage milestones last (Phase C, medium risk, own release).
- **CON-001 pattern preserved**: A5's INTERNALS.md update locks in the architectural principle the session demonstrated. Future work inherits the discipline.
- **Greenfield's ranking honored**: B-III.1 (passive surfacing) and B-III.2 (curator pre-recommend) ship in v0.63.0 per the field signal; B-III.3 (context_init refactor) ships in v0.63.0 but scope-corrected to code-review.md + dev-workflow.md only.
- **Aligns with [[project-devt-north-star-goals]]**: output quality (better gates closing silent skips), token usage (no wasted dispatches from gate false-negatives), graphify integration (symbol-extraction unlock + Bitbucket tier close the biggest project gaps).

---

## Phase A2 — v0.62.2 patch (surgical bug fixes from greenfield audit + calibration #3) — ✅ SHIPPED 2026-05-28

> **Status**: SHIPPED as v0.62.2. All 5 tasks (A2-1 through A2-5) completed. Smoke 685 → 689/0.
>
> **Commits**: 8a0c9fd (A2-1 PREFLIGHT walk-up scope fix), a6333ed (A2-2 MCP namespace drift in 4 workflows), f7f618c (A2-3 debug.md auto_refresh_post_impl), f3bc1df (A2-4 state release CLI + cancelled phase), 7a730ec (A2-5 v0.62.2 release).
>
> Task bodies below preserved as audit trail. New work continues in Phase B.

**Theme**: ship four field-validated surgical fixes between v0.62.1 and v0.63.0. All have forensic evidence in greenfield-api's filesystem (preflight-denies.jsonl, dispatch-warnings.jsonl, graphify-audit.md).

**Smoke target**: 685 → 689 (+K8/K9/K10/K11) — **ACHIEVED**.

**Effort**: ~2h.

### Task A2-1: PREFLIGHT walk-up scope fix

**Validated finding** (greenfield preflight-denies.jsonl, 10+ entries):
> Out-of-project paths trigger PREFLIGHT warnings: `/tmp/simplify-pr367-*.md`, `/Users/emrec/.claude/plans/*.md`. Hook walks up from cwd to find any `.devt/`, then validates the (out-of-project) target file path against the project's scratchpad.

`hooks/pre-flight-guard.sh:44-49` walks up to find project root. Once resolved, the hook should refuse to fire when the target file is NOT a descendant of resolved root.

- [ ] **Step 1**: After resolving `dir` (project root), add: `if (!fp.startsWith(dir + path.sep)) process.exit(0);`
- [ ] **Step 2**: Smoke gate K8 — fixture creates project with .devt/, attempts edit on /tmp/foo.md; hook exits 0 (no scratchpad-missing complaint), no preflight-denies entry written.
- [ ] **Step 3**: Commit `fix(preflight): refuse to fire on out-of-project file paths`.

### Task A2-2: MCP namespace drift in 4 workflows

**Validated finding** (greenfield-api graphify-audit.md): `dev-workflow.md`, `debug.md`, `quick-implement.md`, `research-task.md` each have 3 functional `mcp__devt-graphify__*` references (unprefixed, broken) where the working form is `mcp__plugin_devt_devt-graphify__*`. **12 broken tool references across 4 workflows.**

- [ ] **Step 1**: For each of the 4 workflows, apply sed with non-pipe delimiter (`#`):
```bash
sed -i.bak -E 's#`mcp__devt-graphify__(blast_radius|get_neighbors|query_graph)`#`mcp__plugin_devt_devt-graphify__\1`#g' workflows/<name>.md
```
- [ ] **Step 2**: Verify trace-filter comments (mcp-stats lines using `*` wildcard) are unchanged.
- [ ] **Step 3**: Smoke gate K9 — assert zero functional unprefixed references in dev/debug/research-task/quick-implement workflows (trace-filter comments excluded via `* ` wildcard guard).
- [ ] **Step 4**: Commit `fix(workflows): namespace drift in 4 workflows — 12 unprefixed MCP refs → prefixed`.

### Task A2-3: debug.md `auto_refresh_post_impl` hook

**Validated finding**: dev-workflow.md has 5 hits for `auto_refresh_post_impl`, debug.md has 0. Post-debug-fix doesn't refresh the graph; next code-review fires on stale data.

- [ ] **Step 1**: Identify the dev-workflow.md hook block (around line 947), copy verbatim into debug.md's post-fix step.
- [ ] **Step 2**: Smoke gate K10 — debug.md grep returns ≥1 hit for `auto_refresh_post_impl`.
- [ ] **Step 3**: Commit `feat(workflows): debug.md gains auto_refresh_post_impl hook (parity with dev-workflow.md)`.

### Task A2-4: `state release` CLI + "cancelled" phase

**Validated finding** (greenfield #3): no `state release` subcommand exists; workaround `state update active=false phase=cancelled status=cancelled` correctly trips VALID_PHASES warning because "cancelled" isn't in the enum.

- [ ] **Step 1**: Add `"cancelled"` to `PHASE_ORDER` set in `bin/modules/state.cjs:174` area.
- [ ] **Step 2**: Add `state release` subcommand to `bin/devt-tools.cjs` that calls a new `state.cjs::releaseWorkflow()` setting `active=false, phase=cancelled, status=cancelled` atomically with a `released_at` timestamp.
- [ ] **Step 3**: Smoke gate K11 — `state release` on an active workflow flips active=false, phase=cancelled, status=cancelled; no warning.
- [ ] **Step 4**: Commit `feat(state): add state release CLI subcommand for clean workflow lock release`.

### Task A2-5: v0.62.2 release

- [ ] Bump VERSION 0.62.1 → 0.62.2 + plugin.json
- [ ] CHANGELOG [0.62.2] section — theme: "four surgical bug fixes from greenfield audit"
- [ ] Final smoke 685 → ~689
- [ ] `scripts/release.sh 0.62.2`

---

## New v0.63.0 candidates (from greenfield audit + calibration #3, secondary side-request)

The following items surfaced from greenfield's two graphify audits + calibration #3 (parallel review session). Not in v0.62.2 because each touches multi-file workflow logic.

### Task B-VIII (NEW): Lane scope pre-warn + auto-split

**Validated finding** (greenfield calibration #3 finding #1): Lane C with 25 files / 1577 LOC consistently exceeded maxTurns: 40 budget on both dispatches.

- [ ] Workflow change in `code-review-parallel.md::partition_lanes`: pre-compute file count + estimated LOC per lane; warn (or auto-split) when lane > 15 files OR > 800 LOC.
- [ ] Effort: ~2h.

### Task B-IX (NEW): Lane redispatch with reduced scope

**Validated finding** (greenfield calibration #3 finding #2): On stub-retry, identical re-dispatch wastes budget; ask for "5 highest-signal findings only" trades completeness for substance.

- [ ] Workflow protocol change in `code-review-parallel.md`: on substance-check failure, re-dispatch prompt template differs (top-5 highest-signal request).
- [ ] Effort: ~1.5h.

### Task B-X (NEW): code-review-parallel.md zero-MCP fix

**Validated finding** (greenfield audit): code-review-parallel.md has 0 functional MCP calls — only mcp-stats trace-filter comments. Parallel review can't drill down because it inherits nothing from code-review.md's MCP setup.

- [ ] Investigate whether parallel lanes should consume orchestrator-prepared graph-impact.md (architectural — confirms "lanes are MCP-blind by design") or whether the parallel workflow needs its own MCP setup phase.
- [ ] Effort: ~2-3h pending architectural decision.

### Task B-XI (NEW): Bulk-scoped tier — symbol_anchored from diff

**Validated finding** (greenfield calibration #3 finding #4): For bitbucket + dense + >10 files, `query_graph(text=$REVIEW_SCOPE)` is rarely useful (text-search yields keyword hits not call-graph). Better: symbol_anchored driven from `git diff --name-only` mapped to graph nodes.

- [ ] Tier decision logic change in `workflows/code-review.md` around line 145-156: when bitbucket provider + scope > 10 files + dense graph, prefer symbol_anchored with symbols extracted from diff files via existing `extractDiffSymbols`.
- [ ] Effort: ~2h.

### Task B-XII (NEW): graphify-helpers skill self-contradiction

**Validated finding** (greenfield audit): `agents/code-reviewer.md:50` says "no MCP tool surface"; later step says to use graphify-helpers skill (which calls MCP). Direct conflict.

- [ ] Resolution: either delete graphify-helpers skill OR explicitly mark its CLI-only fallback path AND ensure every loading agent has `Bash` permission for `node bin/devt-tools.cjs graphify *`.
- [ ] Effort: ~30min (decision-then-edit).

### Task B-XIII (NEW): Concern-based partition_lanes mode

**Validated finding** (greenfield calibration #3 finding #5 + audit + Phase C-I.3 from prior plan): path-based partition created god-bucket; orchestrator bypassed with manual concern-based partition.

- [ ] Replace directory-prefix partition with `get_community`-driven (Phase C-I.3 from existing plan); falls back to "split by top-3-level if cap exceeded" when graphify disabled.
- [ ] Effort: ~3-4h (combines with C-I.3).

### Task B-XV (NEW): Symbol-level F17 god-node check

**Validated finding** (greenfield 2026-05-28 calibration #4, defect #3): F17's `checkLargeFilesGodNodes` at `graphify.cjs:912` is file-aggregated (per-basename `max_edges` aggregation). AuditMapping (symbol-level god-node, 198 edges) was caught only by `blast_radius::god_node_match` from orchestrator-MCP, not by deterministic F17. When AuditMapping is in a diff file but NOT in topic.symbols, the symbol-level signal is missed.

**On-disk evidence from greenfield's graph-impact.md:62 (verbatim quote)**: *"F17 diff-file god-node check: 0 file-level god-nodes in PR #374 diff despite symbol-level god-node match on AuditMapping."* — the workflow output itself documents the bug.

**Implementation simplification** (validated 2026-05-28 late): `bin/modules/graphify.cjs:892::godNodes(limit)` ALREADY returns symbol-level god-node data — iterates nodeMap, computes per-symbol degree (`(inc.get(id) || []).length + (out.get(id) || []).length`), filters file/concept/JSON-key nodes, returns top-N by degree. B-XV doesn't need new graph traversal — just filter `godNodes()` output by `source_file ∈ diffFiles`. Effort drops to ~1h.

- [ ] Add `checkSymbolLevelGodNodes(diffFiles, edgeThreshold = 50)` to `bin/modules/graphify.cjs` (sibling function to `checkLargeFilesGodNodes`). Shape:

```javascript
function checkSymbolLevelGodNodes(diffFiles, edgeThreshold = 50) {
  if (!Array.isArray(diffFiles) || diffFiles.length === 0) return [];
  const wantBasenames = new Set(diffFiles.map(f => path.basename(f)));
  // godNodes(200) gives us ample candidates above the typical god-node
  // floor; filter to those whose source_file is in the diff.
  return godNodes(200)
    .filter(g => {
      const sf = g.node && g.node.source_file;
      return sf && wantBasenames.has(path.basename(sf));
    })
    .map(g => ({
      symbol: g.node.label || g.id,
      source_file: g.node.source_file,
      edge_count: g.degree,
      is_god_node: g.degree >= edgeThreshold,
    }))
    .filter(r => r.is_god_node);
}
```

- [ ] Wire into `code-review.md::F17` step alongside file-level check. Output appended to `graph-impact.md` under `## Symbol-level god-nodes` heading.
- [ ] Update workflow `### Note on signal independence` (code-review.md:200) — now three signals: blast_radius symbol-aggregated, F17 file-aggregated, F17 symbol-level (the new one).
- [ ] Smoke gate: fixture with diff file containing a synthetic high-degree symbol (≥50 edges) surfaces it independently of topic.symbols.
- [ ] Effort: ~1h (down from ~2h after infrastructure reuse discovery).

### Task B-XVI (NEW): mcp-stats correlation_id

**Validated finding** (greenfield 2026-05-28 calibration #4, defect #5): trace records carry `args_fp` (12-char fingerprint of args object — NOT unique across identical-args calls) but no explicit per-call ID. Findings in lane outputs cite "blast_radius said X" but can't trace back to the specific call timestamp + ID.

**Implementation pattern**:

- [ ] Generate `correlation_id` (8-char hex via `crypto.randomBytes(4).toString('hex')`) at the start of every MCP call in `bin/devt-memory-mcp.cjs`. Inject into both the trace record AND the MCP response envelope.
- [ ] Schema: add `correlation_id: string` to trace record format at `bin/devt-memory-mcp.cjs::544+571`.
- [ ] mcp-stats filter: `--correlation-id=<id>` returns matching record (single-row aggregate).
- [ ] Workflow integration in `code-review.md` (and parallel sibling) — when F16 drill-down writes a `## Drill-down: <symbol>` heading, append `[call: <correlation_id>]` to the heading so the lane reviewer's downstream finding can cite the specific call.
- [ ] Smoke gate: trace records carry 8-char hex correlation_id; mcp-stats filter returns the expected single record.
- [ ] Effort: ~1.5h.

### Task B-XIV — priority bump after calibration #4

The original B-XIV (mcp-stats `--since-workflow-created` flag) was scored as "documentation + telemetry improvement, low priority." Calibration #4 produced concrete evidence that it's blocking observability: greenfield's 82 graphify calls are real but invisible via `mcp-stats --workflow-id=66473ef4` because the calls were stamped under the prior workflow_id (`6863c532`, code_review) before code_review_parallel was activated. The workflow_id rotation issue isn't documentation-only — it makes successful sessions look empty in telemetry.

**Bump priority**: ship B-XIV alongside B-XV + B-XVI as the "mcp-stats observability batch" in v0.63.0. Estimated combined effort: ~3.5h.

### Task B-XIV (NEW): mcp-stats workflow_id propagation diagnostic

**Validated finding** (greenfield calibration #3 finding #6 — nuance correction): trace records DO carry workflow_id, but workflow_id rotates across init→partition transitions; `mcp-stats --workflow-id=<current>` returns empty because trace records were stamped with the PRIOR workflow_id.

- [ ] Add `mcp-stats --since-workflow-created` flag that filters by `ts >= workflow.yaml::created_at` instead of exact workflow_id match. Documents the rotation behavior in INTERNALS.md::MCP Trace.
- [ ] Effort: ~1h.

### Audit-additional gaps (lower priority)

From greenfield's audit, additional items for v0.64.0+:

- `tester.md` has no graphify input (test-coverage decisions miss callers) — workflow + agent prose change, ~2h
- `verifier.md` may lack scope_trust (low confidence — needs verification) — diagnostic + fix, ~1h
- `io-contracts.yaml` doesn't declare graphify dependencies — schema addition, ~1.5h
- Dead MCP tools (`get_node`, `graph_stats`) — wire-or-remove decision, ~1h

---

## Change history

- **2026-05-28 (morning)** — Initial plan with 3 phases (operational v0.62.1 / memory UX v0.63.0 / Bitbucket v0.64.0). Commit `cd279a8`.
- **2026-05-28 (afternoon)** — Revised after greenfield calibration #2 (GFBUGS-180 quick-implement session). Added: A6-A10 surgical hotfixes (F31 placeholder regex, SYMBOL_DENYLIST extension, lane-JSON eviction, verifier gate workflow_type-awareness, mcp-stats CLI-wrapper caveat docs). Restructured Phase B into 3 sub-batches: B-I symbol extraction unlock (the cascading SKIP root cause), B-II anti-escape-hatch gate strictening (3 silent-skip vectors closed), B-III memory UX (greenfield-validated B0+B3 priorities, B2 scope-corrected, B1+B4+B5 deferred). Added Phase D agent-truncation research spike. Total: 26 items reviewed → 23 kept, 3 rejected, 7 deferred.
- **2026-05-28 (evening)** — v0.62.1 shipped. Greenfield calibration #3 + secondary side-request (parallel review session) surfaced 6 new findings + audit confirmations: 4 dead MCP tools, code-review-parallel zero-MCP, graphify-helpers self-contradiction, namespace drift across 4 workflows, PREFLIGHT walk-up bug, missing state release CLI. Added Phase A2 (v0.62.2 patch) with 4 surgical tasks (PREFLIGHT scope, namespace drift, debug.md auto_refresh, state release CLI) and 7 new v0.63.0 candidates (lane scope pre-warn, lane scoped-redispatch, bulk-scoped tier improvement, graphify-helpers resolution, concern-based partition, code-review-parallel MCP audit, mcp-stats since-workflow-created flag).
- **2026-05-28 (later evening)** — v0.62.2 staged locally (5 commits). Greenfield calibration #4 (parallel review session against v0.62.1 — 82 graphify calls, 0 errors, verifier ran 93/100) surfaced 5 findings, 2 devt-actionable: B-XV (symbol-level F17 god-node check — file-aggregated only today) and B-XVI (mcp-stats correlation_id — args_fp exists but no explicit finding→call linkage). The other 3 findings (Bitbucket pr_scoped, namespace disambiguation, suggest-time evidence) are graphify-upstream limitations devt cannot fix directly. Phase C-II Bitbucket PR tier remains in plan as devt-side workaround.
- **2026-05-28 (deeper validation pass)** — Validated calibration #4 findings against on-disk evidence. Three corrections to plan: (1) B-XV effort drops to ~1h (was ~2h) — `graphify.cjs:892::godNodes()` ALREADY returns symbol-level data; B-XV just filters by diff-file source_file. Implementation skeleton documented inline. (2) B-XV's evidence base is now anchored to verbatim graph-impact.md:62 quote from greenfield — the workflow output itself documents the F17 gap. (3) B-XIV priority bumped — `grep workflow_id=66473ef4 _mcp-trace.jsonl` returns 0 matches in greenfield's logs even though 82 calls were made; the workflow_id rotation issue is blocking observability, not just documentation-cosmetic. Recommended scheduling: ship B-XIV + B-XV + B-XVI together as the "mcp-stats observability batch" in v0.63.0 (~3.5h combined). Positive signals validated: verification.json shows VERIFIED + verdict:satisfied + total_score:93 + 8/8 criteria met; 5 lanes all substance_pass — v0.62.1's A9 verifier gate is functioning under realistic load.
- **2026-05-28 (release confirmation)** — Both v0.62.1 and v0.62.2 shipped to remote (tags + GitHub releases visible). Greenfield will surface the 16 commits worth of fixes on next devt update pull. Active scope is now v0.63.0; next session starts with the mcp-stats observability batch (B-XIV + B-XV + B-XVI) per agreed sequencing.
