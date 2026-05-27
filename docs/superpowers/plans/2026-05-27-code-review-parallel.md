# Code-Review Parallel-Lane Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class parallel-lane review workflow (`/devt:review-parallel` semantics, surfaced via `AskUserQuestion` from `/devt:review` when scope > 10 files) that partitions work by graphify community, dispatches lanes in foreground parallel, substance-gates each lane, and consolidates outputs through a synthesis dispatch.

**Architecture:** Foreground parallel dispatch (single message, N `Task()` calls — Anthropic-canonical idiom). Community-based partitioning capped at 5 lanes. F28 substance check per-lane with retry-once-then-defer. Re-dispatch via canonical workflow template (closes L1 hook compliance). Consolidator = code-reviewer re-dispatched in synthesis mode. Existing verify step unchanged.

**Tech Stack:** Node.js stdlib only (CommonJS `.cjs`), Markdown workflow files with YAML frontmatter, Bash gates, JSON sidecars.

**Spec:** `docs/superpowers/specs/2026-05-27-code-review-parallel-design.md`

**Smoke target:** 629 → 641 (+12 gates)

**Version bump:** 0.58.4 → 0.59.0 (minor — new feature)

---

## Phase 1 — State foundation (lanes registry + CLI)

### Task 1: Add VALID_LANE_STATUSES enum + slugify helper

**Files:**
- Modify: `bin/modules/state.cjs` (add constants near `VALID_WORKFLOW_TYPES`, add helper function)

- [ ] **Step 1: Read existing constants block to find insertion point**

```bash
grep -nE "^const VALID_WORKFLOW_TYPES" /Users/emrec/Projects/devt/bin/modules/state.cjs
```
Expected: a line number around 279.

- [ ] **Step 2: Add the enum + slugify helper immediately after VALID_WORKFLOW_TYPES block**

Find the block ending (the closing `]);` of `VALID_WORKFLOW_TYPES`) and insert below it:

```javascript
// Lane-status enum for code-review-parallel.md::workflow.yaml::lanes[].
// in_flight       — Task() dispatched, lane file may be empty/stub
// substance_pass  — state check-agent-output returned ok:true
// stub_redispatched — first F28 stub; will be re-dispatched once
// deferred        — second F28 stub OR harness failure; consolidator notes it
const VALID_LANE_STATUSES = new Set([
  "in_flight", "substance_pass", "stub_redispatched", "deferred",
]);

// Slug normalization for lane file names. Graphify affected_communities[].name
// can carry spaces, hyphens, slashes, or other separators that would produce
// invalid filenames. Rule: lowercase, replace non-alphanum with underscore,
// collapse repeats, trim, cap at 32 chars. Deterministic and stable across
// re-partitions.
function slugifyLaneName(name) {
  if (!name || typeof name !== "string") return "ungrouped";
  const slug = name.toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
  return slug || "ungrouped";
}
```

- [ ] **Step 3: Export the helper + enum**

Find the `module.exports = { ... }` block (near end of file). Add the two new symbols inside the export object:

```javascript
module.exports = {
  // … existing exports …
  VALID_LANE_STATUSES,
  slugifyLaneName,
};
```

- [ ] **Step 4: Sanity-check the function with a quick CLI eval**

```bash
node -e 'const {slugifyLaneName} = require("/Users/emrec/Projects/devt/bin/modules/state.cjs"); console.log(JSON.stringify([slugifyLaneName("Auth Subgraph"), slugifyLaneName("billing/core"), slugifyLaneName(""), slugifyLaneName("a".repeat(50))]))'
```
Expected: `["auth_subgraph","billing_core","ungrouped","aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]`

- [ ] **Step 5: Commit**

```bash
cd /Users/emrec/Projects/devt
git add bin/modules/state.cjs
git commit -m "feat(state): add VALID_LANE_STATUSES + slugifyLaneName for code-review-parallel"
```

---

### Task 2: Add `state list-lane-outputs` CLI subcommand

**Files:**
- Modify: `bin/modules/state.cjs` (add `listLaneOutputs` function + dispatcher case + export)

- [ ] **Step 1: Add the function just after `assertVerifierRan` (find it via grep)**

```bash
grep -n "^function assertVerifierRan" /Users/emrec/Projects/devt/bin/modules/state.cjs
```

Insert this function after `assertVerifierRan`'s closing brace:

```javascript
// Surfaces the canonical lane registry from workflow.yaml::lanes[] alongside
// each lane's review file existence + size. Consumed by code-review-parallel.md's
// substance_check_lanes + consolidate steps. Returns empty lanes:[] when no
// parallel workflow is active (lanes key missing from workflow.yaml).
function listLaneOutputs() {
  const dir = getStateDir();
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const wfPath = path.join(dir, "workflow.yaml");
  if (!fs.existsSync(wfPath)) {
    return { lanes: [], reason: "no workflow.yaml" };
  }
  const yaml = fs.readFileSync(wfPath, "utf8");
  // Light YAML parse: the lanes[] block uses a fixed shape; we extract via
  // line-based parsing to avoid pulling in a YAML library (zero-deps rule).
  const lanes = [];
  const laneRe = /^  - id:\s*"?([^"\n]+)"?\s*$/gm;
  const blocks = yaml.split(/^  - id:/m).slice(1);
  for (const block of blocks) {
    const id = (block.match(/^\s*"?([^"\n]+)"?\s*$/m) || [])[1];
    const community = (block.match(/^\s+community:\s*"?([^"\n]+)"?\s*$/m) || [])[1];
    const reviewFile = (block.match(/^\s+review_file:\s*"?([^"\n]+)"?\s*$/m) || [])[1];
    const status = (block.match(/^\s+status:\s*"?([^"\n]+)"?\s*$/m) || [])[1];
    const redispatchCount = parseInt(
      (block.match(/^\s+redispatch_count:\s*(\d+)\s*$/m) || [])[1] || "0", 10);
    if (!id) continue;
    let sizeBytes = 0;
    let exists = false;
    if (reviewFile) {
      try {
        sizeBytes = fs.statSync(reviewFile).size;
        exists = true;
      } catch { /* file absent — leave defaults */ }
    }
    lanes.push({
      id: id ? id.trim() : null,
      community: community ? community.trim() : null,
      review_file: reviewFile ? reviewFile.trim() : null,
      status: status ? status.trim() : null,
      redispatch_count: redispatchCount,
      file_exists: exists,
      file_size_bytes: sizeBytes,
    });
  }
  return { lanes };
}
```

- [ ] **Step 2: Register the CLI dispatcher case**

Find the `case "check-agent-output":` block in the `run(subcommand, args)` function and add a new case right after it:

```javascript
    case "list-lane-outputs":
      return listLaneOutputs();
```

- [ ] **Step 3: Update the "Unknown state subcommand" error message**

Find the error throw `Unknown state subcommand: ${subcommand}. Use: ...` and append `list-lane-outputs` to the comma-separated list.

- [ ] **Step 4: Export the function**

Add `listLaneOutputs` to `module.exports`.

- [ ] **Step 5: Behavioral test — empty case**

```bash
cd /tmp && rm -rf laneout-test && mkdir laneout-test && cd laneout-test
mkdir -p .devt/state
echo '{}' > .devt/config.json
node /Users/emrec/Projects/devt/bin/devt-tools.cjs state list-lane-outputs
```
Expected: `{"lanes":[],"reason":"no workflow.yaml"}`

- [ ] **Step 6: Behavioral test — populated case**

```bash
cd /tmp/laneout-test
cat > .devt/state/workflow.yaml <<'EOF'
active: true
workflow_id: "test-wf"
lanes:
  - id: "L1"
    community: "auth_subgraph"
    review_file: ".devt/state/review-lane-auth_subgraph.md"
    status: "in_flight"
    redispatch_count: 0
  - id: "L2"
    community: "billing_subgraph"
    review_file: ".devt/state/review-lane-billing_subgraph.md"
    status: "substance_pass"
    redispatch_count: 0
EOF
echo "stub content" > .devt/state/review-lane-billing_subgraph.md
node /Users/emrec/Projects/devt/bin/devt-tools.cjs state list-lane-outputs | jq -c '.lanes[] | {id, status, file_exists}'
```
Expected:
```
{"id":"L1","status":"in_flight","file_exists":false}
{"id":"L2","status":"substance_pass","file_exists":true}
```

- [ ] **Step 7: Commit**

```bash
cd /Users/emrec/Projects/devt
git add bin/modules/state.cjs
git commit -m "feat(state): add state list-lane-outputs CLI subcommand"
```

---

### Task 3: Add `state update-lane` CLI subcommand

**Files:**
- Modify: `bin/modules/state.cjs` (add `updateLane` function + dispatcher case + export)

- [ ] **Step 1: Add the function just after `listLaneOutputs`**

```javascript
// Mutate a single lane's status (and optionally redispatch_count) in
// workflow.yaml. CLI shape mirrors existing `state update key=value` idiom:
//   node bin/devt-tools.cjs state update-lane L1 status=deferred
//   node bin/devt-tools.cjs state update-lane L1 status=stub_redispatched redispatch_count=1
// Returns the updated lane record (or {ok:false, reason} on validation error).
function updateLane(laneId, kvPairs) {
  if (!laneId || typeof laneId !== "string") {
    return { ok: false, reason: "no lane-id provided" };
  }
  const updates = {};
  for (const kv of (kvPairs || [])) {
    const [k, v] = kv.split("=", 2);
    if (!k || v === undefined) continue;
    if (k === "status") {
      if (!VALID_LANE_STATUSES.has(v)) {
        return { ok: false, reason: `invalid status "${v}" (allowed: ${[...VALID_LANE_STATUSES].join(", ")})` };
      }
      updates.status = v;
    } else if (k === "redispatch_count") {
      const n = parseInt(v, 10);
      if (isNaN(n) || n < 0) {
        return { ok: false, reason: `invalid redispatch_count "${v}" (must be non-negative integer)` };
      }
      updates.redispatch_count = n;
    } else {
      return { ok: false, reason: `unknown lane field "${k}" (allowed: status, redispatch_count)` };
    }
  }
  if (Object.keys(updates).length === 0) {
    return { ok: false, reason: "no updates provided (need status=... or redispatch_count=...)" };
  }
  const dir = getStateDir();
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const wfPath = path.join(dir, "workflow.yaml");
  if (!fs.existsSync(wfPath)) {
    return { ok: false, reason: "no workflow.yaml" };
  }
  const yaml = fs.readFileSync(wfPath, "utf8");
  // Locate the lane block by id, then mutate the status/redispatch_count
  // lines in-place. Conservative line-based edit preserves YAML formatting.
  const lines = yaml.split("\n");
  let inLane = false;
  let mutated = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^  - id:\s*"?/.test(line)) {
      inLane = line.includes(`"${laneId}"`) || line.replace(/^  - id:\s*"?/, "").replace(/"\s*$/, "").trim() === laneId;
    } else if (/^[a-z_]/.test(line)) {
      inLane = false;
    }
    if (!inLane) continue;
    if (updates.status !== undefined && /^\s+status:\s*/.test(line)) {
      lines[i] = line.replace(/status:\s*"?[^"\n]*"?/, `status: "${updates.status}"`);
      mutated = true;
    }
    if (updates.redispatch_count !== undefined && /^\s+redispatch_count:\s*/.test(line)) {
      lines[i] = line.replace(/redispatch_count:\s*\d+/, `redispatch_count: ${updates.redispatch_count}`);
      mutated = true;
    }
  }
  if (!mutated) {
    return { ok: false, reason: `lane id "${laneId}" not found in workflow.yaml::lanes[]` };
  }
  atomicWriteFileSync(wfPath, lines.join("\n"));
  return { ok: true, lane_id: laneId, updates };
}
```

- [ ] **Step 2: Confirm atomicWriteFileSync is in scope (it should already be imported via io.cjs)**

```bash
grep -nE "atomicWriteFileSync|require.*io.cjs" /Users/emrec/Projects/devt/bin/modules/state.cjs | head -3
```
Expected: an import line near the top of state.cjs showing `atomicWriteFileSync` is destructured from `./io.cjs`. If missing, add `const { atomicWriteFileSync } = require("./io.cjs");` near the top.

- [ ] **Step 3: Register the CLI dispatcher case**

Find `case "list-lane-outputs":` and add right after:

```javascript
    case "update-lane":
      return updateLane(args[0], args.slice(1));
```

- [ ] **Step 4: Update the "Unknown state subcommand" error message**

Append `update-lane` to the comma-separated list.

- [ ] **Step 5: Export the function**

Add `updateLane` to `module.exports`.

- [ ] **Step 6: Behavioral test — happy path**

```bash
cd /tmp/laneout-test
node /Users/emrec/Projects/devt/bin/devt-tools.cjs state update-lane L1 status=substance_pass
grep -A 4 'id: "L1"' .devt/state/workflow.yaml
```
Expected: `{"ok":true,"lane_id":"L1","updates":{"status":"substance_pass"}}` then the yaml block showing `status: "substance_pass"`.

- [ ] **Step 7: Behavioral test — invalid status rejected**

```bash
node /Users/emrec/Projects/devt/bin/devt-tools.cjs state update-lane L1 status=invalid_value
```
Expected: `{"ok":false,"reason":"invalid status \"invalid_value\" (allowed: ...)"}`

- [ ] **Step 8: Behavioral test — unknown lane id**

```bash
node /Users/emrec/Projects/devt/bin/devt-tools.cjs state update-lane L99 status=deferred
```
Expected: `{"ok":false,"reason":"lane id \"L99\" not found in workflow.yaml::lanes[]"}`

- [ ] **Step 9: Commit**

```bash
cd /Users/emrec/Projects/devt
git add bin/modules/state.cjs
git commit -m "feat(state): add state update-lane CLI subcommand with validation"
```

---

## Phase 2 — code-reviewer agent: synthesis mode

### Task 4: Add synthesis-mode handler to agents/code-reviewer.md

**Files:**
- Modify: `agents/code-reviewer.md` (add new handler block at top of execution flow)

- [ ] **Step 1: Find the existing `<execution_flow>` opening tag**

```bash
grep -n "^<execution_flow>" /Users/emrec/Projects/devt/agents/code-reviewer.md
```

- [ ] **Step 2: Insert the synthesis-mode handler immediately after `<execution_flow>`**

```markdown
**Lane synthesis mode (code-review-parallel only).** When the dispatch `<task>` instruction begins with the literal phrase "Synthesize the N lane review files", DO NOT perform a fresh code review. Instead:

1. Read every path listed in the `<lane_files>` context block (one per line).
2. Parse findings from each lane. Standard finding format: `<severity>-<id>: <file>:<line> — <description>`.
3. Dedupe by `(file:line:finding_class)`. Two findings with the same file + line + class are the same issue; collapse into one entry.
4. Reconcile severity using the rubric (Critical > Important > Minor > Suggestion). When two lanes assign different severities to the same finding, keep the highest.
5. Preserve all Critical findings even when only one lane flagged them.
6. Group the consolidated finding list by file in the output `review.md`.
7. Write `review.md` + `review.json` exactly as the single-dispatch path does (same schema, same severity buckets).
8. In `review.md`, add a `## Lane Provenance` section listing each lane id, community, status, and finding count contributed.

Do NOT issue new graphify queries, do NOT re-read source files beyond what the lane authors cite, do NOT add findings the lanes didn't surface. Your job is dedup + reconciliation, not fresh review.

When all lanes are in `status: deferred`, write `review.md` with a single `## All Lanes Failed` section noting the deferral reasons, and write `review.json` with `verdict: "failed"`. The verifier will route through STOP-with-BLOCKED.
```

- [ ] **Step 3: Verify byte-stability lint compatibility**

The new block has no `$(date …)`, `Date.now()`, or ISO timestamps in prose. Confirm via:

```bash
grep -nE 'new Date\(\)|Date\.now\(\)|\$\(date\b' /Users/emrec/Projects/devt/agents/code-reviewer.md
```
Expected: no new hits (only existing matches inside code fences).

- [ ] **Step 4: Commit**

```bash
cd /Users/emrec/Projects/devt
git add agents/code-reviewer.md
git commit -m "feat(agents): add lane synthesis mode to code-reviewer"
```

---

## Phase 3 — code-review-parallel.md workflow

### Task 5: Create workflow file with context_init step

**Files:**
- Create: `workflows/code-review-parallel.md`

- [ ] **Step 1: Read the code-review.md context_init block (lines ~56-250) to copy structure**

```bash
sed -n '1,55p' /Users/emrec/Projects/devt/workflows/code-review.md
```
Note the YAML frontmatter shape.

- [ ] **Step 2: Create the new workflow file with frontmatter + context_init**

```bash
cat > /Users/emrec/Projects/devt/workflows/code-review-parallel.md <<'WFEOF'
---
description: Parallel-lane code review — partitions scope by graphify community, dispatches N lanes in foreground parallel, consolidates outputs. Delegated to from /devt:review when scope > 10 files AND user opts in via AskUserQuestion. Inherits all gates from code-review.md.
allowed-tools: Read, Bash, Glob, Grep, Task, AskUserQuestion
argument-hint: "<scope-description>"
---

# Parallel-Lane Code Review Workflow

> **KEEP IN SYNC**: This workflow re-uses the same context_init payload + verify step as `workflows/code-review.md`. When you change one, audit the other. Smoke gate F36b enforces that both files share the same governing_rules / memory_signal / scope_trust prep idioms.

This workflow is invoked from `code-review.md::scope_check` when the review scope exceeds 10 files AND the user opts into parallel via `AskUserQuestion`. It is NOT a user-facing slash command — there is no `/devt:review-parallel`; the routing is internal to `/devt:review`.

<step name="context_init" gate="compound init succeeds + lane partition computed">

Initialize the workflow (delegated from code-review.md; the upstream step already wrote workflow.yaml::active=true and ran preflight + memory_signal cache). Re-read the cached context blocks:

```bash
STATE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state read)
REVIEW_SCOPE=$(echo "$STATE" | jq -r '.task // ""')
MEMORY_SIGNAL=$(echo "$STATE" | jq -r '.memory_signal_json // "{}"')
SCOPE_HINT=$(echo "$STATE" | jq -r '.scope_hint_json // "[]"')
SCOPE_TRUST=$(echo "$STATE" | jq -r '.scope_trust_json // "{}"')
WORKFLOW_ID=$(echo "$STATE" | jq -r '.workflow_id // empty')
```

Update the workflow_type to mark this as the parallel path:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update workflow_type=code_review_parallel phase=context_init status=DONE
```

**Note**: `workflow_type=code_review_parallel` must be added to `VALID_WORKFLOW_TYPES` in `bin/modules/state.cjs` AND routed in `workflows/next.md` + `workflows/status.md` (handled in Task 13).

</step>
WFEOF
```

- [ ] **Step 3: Sanity-check the file is well-formed YAML frontmatter**

```bash
head -10 /Users/emrec/Projects/devt/workflows/code-review-parallel.md
```
Expected: starts with `---`, has `description:`, `allowed-tools:`, `argument-hint:`, ends with `---` on line 5 or so.

- [ ] **Step 4: Commit**

```bash
cd /Users/emrec/Projects/devt
git add workflows/code-review-parallel.md
git commit -m "feat(workflows): scaffold code-review-parallel.md with context_init step"
```

---

### Task 6: Add partition_lanes step

**Files:**
- Modify: `workflows/code-review-parallel.md` (append partition_lanes step)

- [ ] **Step 1: Append the step to the workflow file**

```bash
cat >> /Users/emrec/Projects/devt/workflows/code-review-parallel.md <<'WFEOF'

<step name="partition_lanes" gate="lanes[] written to workflow.yaml OR fallback decision recorded">

Read `graph-impact.md` to extract `affected_communities`. Partition files into lanes by community, cap at 5 lanes, write the registry to `workflow.yaml::lanes[]`.

```bash
GRAPH_IMPACT_PATH=".devt/state/graph-impact.md"
if [ ! -f "$GRAPH_IMPACT_PATH" ]; then
  echo "FALLBACK: graph-impact.md absent — parallel partition requires graphify; routing back to single-dispatch"
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=context_init status=DONE workflow_type=code_review
  echo "Re-run /devt:review for community-filter single-dispatch path"
  exit 0
fi

# Parse affected_communities from graph-impact.md. Expected format: a section
# like `## Affected Communities` with bullet lines naming each community.
# graphify writes this section when blast_radius returns multi-community impact.
COMMUNITIES_RAW=$(awk '/^## Affected Communities/,/^## /' "$GRAPH_IMPACT_PATH" | grep -E '^- ' | sed 's/^- //' | head -5)
COMMUNITY_COUNT=$(echo "$COMMUNITIES_RAW" | grep -cE '.')

if [ "$COMMUNITY_COUNT" -eq 0 ]; then
  echo "FALLBACK: graph-impact.md has no affected_communities — routing to single-dispatch + community-filter"
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=context_init status=DONE workflow_type=code_review
  exit 0
fi

# Read the diff file list from code-review-input.md, bucket each file into
# the first community whose name substring matches the file path. Files with
# no community match go into "ungrouped".
SCOPE_FILES=$(cat .devt/state/code-review-input.md 2>/dev/null | grep -vE '^#|^$' || echo "")

# Build the lanes[] YAML block. Slug normalization happens via the CLI helper.
LANES_BLOCK="lanes:\n"
LANE_NUM=1
echo "$COMMUNITIES_RAW" | while IFS= read -r COMMUNITY; do
  [ -z "$COMMUNITY" ] && continue
  SLUG=$(node -e "const {slugifyLaneName} = require('${CLAUDE_PLUGIN_ROOT}/bin/modules/state.cjs'); console.log(slugifyLaneName('$COMMUNITY'))")
  # Filter scope files whose path contains a token from the community name
  COMMUNITY_TOKENS=$(echo "$COMMUNITY" | tr -c '[:alnum:]' ' ' | tr '[:upper:]' '[:lower:]')
  LANE_FILES=$(echo "$SCOPE_FILES" | grep -iF "$(echo $COMMUNITY_TOKENS | tr ' ' '\n' | head -3 | head -1)" 2>/dev/null | head -20)
  TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  echo "  - id: \"L${LANE_NUM}\""
  echo "    community: \"${COMMUNITY}\""
  echo "    slug: \"${SLUG}\""
  echo "    review_file: \".devt/state/review-lane-${SLUG}.md\""
  echo "    status: \"in_flight\""
  echo "    redispatch_count: 0"
  echo "    dispatched_at: \"${TS}\""
  LANE_NUM=$((LANE_NUM + 1))
done > /tmp/devt-lanes-block.yaml

# Append lanes block to workflow.yaml (idempotent: strip any prior lanes: section first)
node -e '
const fs = require("fs");
const path = ".devt/state/workflow.yaml";
let yaml = fs.readFileSync(path, "utf8");
// Strip any existing lanes: block (everything from "^lanes:" to next top-level key or EOF)
yaml = yaml.replace(/^lanes:[\s\S]*?(?=^[a-z_]+:|$)/m, "");
const lanesBlock = "lanes:\n" + fs.readFileSync("/tmp/devt-lanes-block.yaml", "utf8");
fs.writeFileSync(path, yaml.trimEnd() + "\n" + lanesBlock);
'
rm -f /tmp/devt-lanes-block.yaml

LANES_OUT=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state list-lane-outputs)
LANE_COUNT=$(echo "$LANES_OUT" | jq '.lanes | length')
echo "Partitioned into ${LANE_COUNT} lanes (cap=5)"
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=partition_lanes status=DONE
```

**Gate**: If the partition produced 0 lanes (graphify absent or empty communities), the step routes back to the standard `code-review.md` single-dispatch path and exits cleanly. The parallel workflow only proceeds when ≥ 1 lane was successfully partitioned.

</step>
WFEOF
```

- [ ] **Step 2: Commit**

```bash
cd /Users/emrec/Projects/devt
git add workflows/code-review-parallel.md
git commit -m "feat(workflows): add partition_lanes step with graphify-fallback to single-dispatch"
```

---

### Task 7: Add dispatch_lanes step (foreground parallel)

**Files:**
- Modify: `workflows/code-review-parallel.md` (append dispatch_lanes step)

- [ ] **Step 1: Append the step**

```bash
cat >> /Users/emrec/Projects/devt/workflows/code-review-parallel.md <<'WFEOF'

<step name="dispatch_lanes" gate="all lane Task() calls returned in a single foreground batch">

**Foreground parallel dispatch.** Issue ONE message containing N `Task(subagent_type="devt:code-reviewer", …)` calls — one per lane in `workflow.yaml::lanes[]`. Sequential Task calls serialize; only multi-Task-in-one-message gets true parallelism per the Anthropic Task contract (same idiom as `dev-workflow.md:506` researcher+architect parallel dispatch).

Read the lane registry:

```bash
LANES_JSON=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state list-lane-outputs)
```

For each lane in `$LANES_JSON.lanes[]`, prepare a dispatch prompt with these context blocks injected (L1 hook compliance requires ALL three blocks present in every devt:code-reviewer dispatch):

- `<workflow_type>code_review_parallel</workflow_type>`
- `<lane_id>L<N></lane_id>`
- `<lane_community>{community}</lane_community>`
- `<lane_files>{files for this lane}</lane_files>`
- `<scope_trust>{cached from workflow.yaml::scope_trust_json}</scope_trust>`
- `<scope_hint>{filtered to this lane's files only}</scope_hint>`
- `<memory_signal>{cached from workflow.yaml::memory_signal_json}</memory_signal>`
- `<governing_rules>{governing_rules.content from init payload}</governing_rules>`

Task instruction: `Review the files listed in <lane_files>. Write your review to <output_path>. Do NOT review files outside the lane. Use the substance-first protocol — write the stub on first turn, then iterate.`

Output path: each lane's `review_file` from the registry.

**Issue all N Task() calls in ONE message.** Example for 3 lanes:

```
Task(subagent_type="devt:code-reviewer", model="{models.code_reviewer}", prompt="<context>...<lane_id>L1</lane_id>...</context><task>Review the files listed in <lane_files>. Write your review to .devt/state/review-lane-auth_subgraph.md.</task>")
Task(subagent_type="devt:code-reviewer", model="{models.code_reviewer}", prompt="<context>...<lane_id>L2</lane_id>...</context><task>Review the files listed in <lane_files>. Write your review to .devt/state/review-lane-billing_subgraph.md.</task>")
Task(subagent_type="devt:code-reviewer", model="{models.code_reviewer}", prompt="<context>...<lane_id>L3</lane_id>...</context><task>Review the files listed in <lane_files>. Write your review to .devt/state/review-lane-payments.md.</task>")
```

When all Task() calls return (foreground blocks until all complete — each agent bounded by its `maxTurns: 40` frontmatter), proceed to substance_check_lanes.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=dispatch_lanes status=DONE
```

</step>
WFEOF
```

- [ ] **Step 2: Commit**

```bash
cd /Users/emrec/Projects/devt
git add workflows/code-review-parallel.md
git commit -m "feat(workflows): add dispatch_lanes step (foreground parallel)"
```

---

### Task 8: Add substance_check_lanes + redispatch_lanes steps

**Files:**
- Modify: `workflows/code-review-parallel.md`

- [ ] **Step 1: Append both steps**

```bash
cat >> /Users/emrec/Projects/devt/workflows/code-review-parallel.md <<'WFEOF'

<step name="substance_check_lanes" gate="every lane has terminal status (substance_pass | stub_redispatched | deferred)">

After dispatch_lanes returns, run `state check-agent-output` on each lane's review file. F28 catches stub outputs (greenfield 2026-05-26 PR #372 5/6-lanes-stub failure mode).

```bash
LANES_JSON=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state list-lane-outputs)
STUB_LANE_IDS=""
for LANE_ID in $(echo "$LANES_JSON" | jq -r '.lanes[].id'); do
  LANE_FILE=$(echo "$LANES_JSON" | jq -r --arg id "$LANE_ID" '.lanes[] | select(.id == $id) | .review_file')
  LANE_SIZE=$(echo "$LANES_JSON" | jq -r --arg id "$LANE_ID" '.lanes[] | select(.id == $id) | .file_size_bytes')
  # Hard-defer impossibly-fast empty returns (file size < 30 bytes — that's
  # not even a real stub, it's a harness/dispatch failure). No retry.
  if [ "$LANE_SIZE" -lt 30 ]; then
    node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update-lane "$LANE_ID" status=deferred
    echo "Lane $LANE_ID hard-deferred (size=${LANE_SIZE}B — harness failure suspected)"
    continue
  fi
  RESULT=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state check-agent-output "$LANE_FILE")
  if echo "$RESULT" | jq -e '.looks_like_stub == true' >/dev/null 2>&1; then
    REDISPATCH_COUNT=$(echo "$LANES_JSON" | jq -r --arg id "$LANE_ID" '.lanes[] | select(.id == $id) | .redispatch_count')
    if [ "$REDISPATCH_COUNT" -ge 1 ]; then
      node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update-lane "$LANE_ID" status=deferred
      echo "Lane $LANE_ID deferred after retry (second stub)"
    else
      node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update-lane "$LANE_ID" status=stub_redispatched
      STUB_LANE_IDS="$STUB_LANE_IDS $LANE_ID"
    fi
  else
    node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update-lane "$LANE_ID" status=substance_pass
  fi
done
echo "STUB_LANES_FOR_REDISPATCH=$STUB_LANE_IDS"
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=substance_check_lanes status=DONE
```

If `STUB_LANES_FOR_REDISPATCH` is non-empty, proceed to redispatch_lanes. Otherwise jump directly to consolidate.

</step>

<step name="redispatch_lanes" gate="all stub_redispatched lanes have new outputs OR are deferred">

For each lane with `status=stub_redispatched`, issue ONE re-dispatch via the canonical template. All three L1-required context blocks (`<scope_trust>`, `<scope_hint>`, `<memory_signal>`) MUST be present — re-read from cached workflow.yaml to ensure the L1 dispatch-hygiene hook accepts the call. Increment `redispatch_count` BEFORE the Task() call so the next substance_check_lanes pass correctly routes a second stub to deferred.

```bash
LANES_JSON=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state list-lane-outputs)
for LANE_ID in $(echo "$LANES_JSON" | jq -r '.lanes[] | select(.status == "stub_redispatched") | .id'); do
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update-lane "$LANE_ID" redispatch_count=1
done
```

Then issue ONE message with N Task() calls (one per stub_redispatched lane), using EXACTLY the same prompt template as `dispatch_lanes` (same context blocks, same task instruction, same output path). After all Task() calls return, re-run substance_check_lanes via the bash loop — but this time any lane that's still a stub gets `status=deferred` (the retry-once-then-defer terminal).

```bash
# Re-run the substance check loop (copy from substance_check_lanes step).
# Lanes with redispatch_count >= 1 that still look like stubs route to deferred.
LANES_JSON=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state list-lane-outputs)
for LANE_ID in $(echo "$LANES_JSON" | jq -r '.lanes[] | select(.status == "stub_redispatched") | .id'); do
  LANE_FILE=$(echo "$LANES_JSON" | jq -r --arg id "$LANE_ID" '.lanes[] | select(.id == $id) | .review_file')
  RESULT=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state check-agent-output "$LANE_FILE")
  if echo "$RESULT" | jq -e '.looks_like_stub == true' >/dev/null 2>&1; then
    node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update-lane "$LANE_ID" status=deferred
  else
    node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update-lane "$LANE_ID" status=substance_pass
  fi
done
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=redispatch_lanes status=DONE
```

</step>
WFEOF
```

- [ ] **Step 2: Commit**

```bash
cd /Users/emrec/Projects/devt
git add workflows/code-review-parallel.md
git commit -m "feat(workflows): add substance_check_lanes + redispatch_lanes (canonical L1-compliant template)"
```

---

### Task 9: Add consolidate + verify steps

**Files:**
- Modify: `workflows/code-review-parallel.md`

- [ ] **Step 1: Append consolidate step**

```bash
cat >> /Users/emrec/Projects/devt/workflows/code-review-parallel.md <<'WFEOF'

<step name="consolidate" gate="review.md + review.json written by code-reviewer in synthesis mode">

Dispatch the code-reviewer in synthesis mode. The synthesis-mode handler (agents/code-reviewer.md::execution_flow top) reads lane files passed in `<lane_files>` and emits the consolidated review.

Build the lane files list (only `substance_pass` and `deferred` lanes — never include `in_flight` or `stub_redispatched`; those should have been resolved by now):

```bash
LANE_FILES=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state list-lane-outputs | \
  jq -r '.lanes[] | select(.status == "substance_pass" or .status == "deferred") | .review_file' | \
  /usr/bin/grep -v '^$' | paste -sd ',' -)
DEFERRED_COUNT=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state list-lane-outputs | \
  jq '[.lanes[] | select(.status == "deferred")] | length')
SUBSTANCE_COUNT=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state list-lane-outputs | \
  jq '[.lanes[] | select(.status == "substance_pass")] | length')
```

Issue a SINGLE `Task(subagent_type="devt:code-reviewer", …)` call with the synthesis instruction:

```
Task(subagent_type="devt:code-reviewer", model="{models.code_reviewer}", prompt="
  <context>
    <workflow_type>code_review_parallel</workflow_type>
    <lane_files>
{LANE_FILES_NEWLINE_SEPARATED}
    </lane_files>
    <scope_trust>{from workflow.yaml}</scope_trust>
    <scope_hint>{from workflow.yaml}</scope_hint>
    <memory_signal>{from workflow.yaml}</memory_signal>
    <governing_rules>{from init payload}</governing_rules>
  </context>
  <task>
    Synthesize the N lane review files listed in <lane_files> into a single
    .devt/state/review.md (and .devt/state/review.json sidecar). Dedupe findings
    by (file:line:finding_class), reconcile severity using the rubric, preserve
    all Critical findings, group by file. Add a ## Lane Provenance section
    listing each lane's id, community, status, and finding count contributed.
  </task>
")
```

After the dispatch returns, validate that review.md + review.json exist and pass the F28 substance check on review.md (the consolidator could itself return a stub):

```bash
SUBSTANCE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state check-agent-output .devt/state/review.md)
if echo "$SUBSTANCE" | jq -e '.looks_like_stub == true' >/dev/null 2>&1; then
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=consolidate status=BLOCKED verdict=FAILED
  echo "BLOCKED: consolidator returned stub — $(echo "$SUBSTANCE" | jq -r '.reason')"
  exit 0
fi
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=consolidate status=DONE
```

</step>

<step name="verify" gate="verification.json is written or step is skipped">

> **KEEP IN SYNC**: This step body is a duplicate of `workflows/code-review.md::verify`. When you change one, copy to the other. devt's workflow loader does not support partial-file include. Smoke gate F36b enforces both files share the same `state assert-graphify-decision` + `state check-agent-output` + `state assert-verifier-ran` invocations.

_Skip this step if `config.workflow.verification` is `false`._

**Artifact pre-gate**: confirm both `.devt/state/review.md` and `.devt/state/review.json` exist (the consolidator writes these). If either is missing, **STOP with BLOCKED**.

**Substance pre-gate (F28)**: even when the file exists, the consolidator may have returned a placeholder body. Same gate as code-review.md::verify:

```bash
SUBSTANCE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state check-agent-output .devt/state/review.md)
if echo "$SUBSTANCE" | jq -e '.looks_like_stub == true' >/dev/null 2>&1; then
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=verify status=BLOCKED verdict=FAILED
  echo "BLOCKED: consolidated review.md looks like a stub — $(echo "$SUBSTANCE" | jq -r '.reason')"
  exit 0
fi
```

**Orchestrator-prep — read cached context blocks** (same as code-review.md::verify):

```bash
STATE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state read)
MEMORY_SIGNAL=$(echo "$STATE" | jq -r '.memory_signal_json // "{}"')
SCOPE_HINT=$(echo "$STATE" | jq -r '.scope_hint_json // "[]"')
SCOPE_TRUST=$(echo "$STATE" | jq -r '.scope_trust_json // "{}"')
```

Dispatch the verifier with the same prompt template as `code-review.md::verify`'s verifier dispatch — verbatim, including `<rubric_content>`, `<original_task>`, `<memory_signal>`, `<scope_hint>`, `<scope_trust>`, `<governing_rules>`, `<files_to_read>`, `<impl_summary>`, `<decisions>`, `<agent_skills>`. (Copy the exact `Task(subagent_type="devt:verifier", …)` block from `workflows/code-review.md` lines ~365-397.)

Route on verification.json verdict (same as code-review.md::verify lines ~410-426): `satisfied → present_findings`, `needs_revision + VITER < MAX_ITER → RETRY`, `failed → STOP with BLOCKED`.

</step>

<step name="present_findings" gate="findings reported with lane provenance">

> **KEEP IN SYNC** with code-review.md::present_findings.

**Verifier-ran enforcement gate** (same as code-review.md::present_findings):

```bash
VERIF_GATE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-verifier-ran)
if echo "$VERIF_GATE" | jq -e '.ok == false' >/dev/null 2>&1; then
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=verify status=BLOCKED verdict=FAILED
  echo "BLOCKED: $(echo "$VERIF_GATE" | jq -r '.reason')"
  exit 0
fi
```

Read `.devt/state/review.md` and present to user with the standard format (verdict, score, findings by severity, score breakdown, graphify activity surface — copy from code-review.md::present_findings). Additionally, surface the `## Lane Provenance` section verbatim so the user sees which communities contributed which findings.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=present_findings status=DONE
```

</step>
WFEOF
```

- [ ] **Step 2: Verify byte-stability lint compatibility on the new workflow file**

```bash
grep -nE 'new Date\(\)|Date\.now\(\)|\$\(date\b' /Users/emrec/Projects/devt/workflows/code-review-parallel.md
```
Expected: matches `$(date` only inside code fences (the canonical `TS=$(date …)` pattern). If any match is outside a code fence, the byte-stability gate will fail.

- [ ] **Step 3: Commit**

```bash
cd /Users/emrec/Projects/devt
git add workflows/code-review-parallel.md
git commit -m "feat(workflows): add consolidate + verify + present_findings steps to code-review-parallel.md"
```

---

## Phase 4 — code-review.md integration

### Task 10: Add code_review_parallel to VALID_WORKFLOW_TYPES + state.cjs registry

**Files:**
- Modify: `bin/modules/state.cjs` (add to `VALID_WORKFLOW_TYPES` enum)

- [ ] **Step 1: Find VALID_WORKFLOW_TYPES**

```bash
grep -nA 20 "^const VALID_WORKFLOW_TYPES" /Users/emrec/Projects/devt/bin/modules/state.cjs
```

- [ ] **Step 2: Add `"code_review_parallel"` to the Set (alphabetical or grouped with `"code_review"`)**

Find the line containing `"code_review",` in the enum and add `"code_review_parallel",` on the next line.

- [ ] **Step 3: Confirm CI workflow_type registry coverage requirement**

```bash
grep -n "VALID_WORKFLOW_TYPES" /Users/emrec/Projects/devt/.github/workflows/ci.yml 2>/dev/null | head -3
grep -rn "code_review_parallel\|code_review\b" /Users/emrec/Projects/devt/workflows/next.md /Users/emrec/Projects/devt/workflows/status.md 2>/dev/null | head -5
```
The CI smoke gate requires every entry in `VALID_WORKFLOW_TYPES` to have routing in BOTH `next.md` and `status.md`. We will add those in Task 11.

- [ ] **Step 4: Commit**

```bash
cd /Users/emrec/Projects/devt
git add bin/modules/state.cjs
git commit -m "feat(state): register code_review_parallel workflow_type"
```

---

### Task 11: Wire code_review_parallel into next.md + status.md routing

**Files:**
- Modify: `workflows/next.md`
- Modify: `workflows/status.md`

- [ ] **Step 1: Find the existing code_review routing in next.md**

```bash
grep -nB 1 -A 3 "code_review" /Users/emrec/Projects/devt/workflows/next.md
```

- [ ] **Step 2: Add a parallel routing entry right after the code_review entry**

Find the bash case/conditional that maps `code_review` → `/devt:review`. Add a sibling entry:

```bash
# In workflows/next.md, find the existing entry and add this case:
elif [ "$WFLOW_TYPE" = "code_review_parallel" ]; then
  echo "/devt:review (parallel-lane workflow active — re-run delegates back through scope_check)"
```

(Adapt the exact syntax to match the existing routing idiom — the file's own pattern is the contract.)

- [ ] **Step 3: Do the same in status.md**

Same pattern — add `code_review_parallel` as a recognized active workflow_type with a meaningful status message.

- [ ] **Step 4: Verify the smoke gate accepts the new entry**

```bash
bash /Users/emrec/Projects/devt/scripts/smoke-test.sh 2>&1 | grep -iE "workflow_type.*registry|VALID_WORKFLOW_TYPES" | head -5
```
Expected: PASS line confirming registry coverage.

- [ ] **Step 5: Commit**

```bash
cd /Users/emrec/Projects/devt
git add workflows/next.md workflows/status.md
git commit -m "feat(workflows): route code_review_parallel in next.md + status.md"
```

---

### Task 12: Add scope_check step to code-review.md (AskUserQuestion at > 10 files)

**Files:**
- Modify: `workflows/code-review.md` (insert step between context_init and identify_scope)

- [ ] **Step 1: Find the closing tag of `context_init` and the opening of `identify_scope`**

```bash
grep -nE "^</step>|^<step name=" /Users/emrec/Projects/devt/workflows/code-review.md | head -10
```

- [ ] **Step 2: Insert the new step between them**

Find the line that has `</step>` ending context_init (look around line 216 — but verify since this file has been growing). Insert immediately after:

```markdown

<step name="scope_check" gate="scope size measured + parallel decision made if applicable">

Measure the file count in the review scope. If > 10 files AND graphify is ready, offer the user a choice between single-dispatch (with community-filter fallback) and parallel-lane review.

```bash
SCOPE_FILE_COUNT=$(wc -l < .devt/state/code-review-input.md 2>/dev/null | tr -d ' ' || echo 0)
GRAPHIFY_STATE=$(jq -r '.graph_stats.state // "not_ready"' .devt/state/preflight-brief.json 2>/dev/null || echo "not_ready")
echo "scope_check: file_count=${SCOPE_FILE_COUNT}, graphify_state=${GRAPHIFY_STATE}"
```

If `SCOPE_FILE_COUNT ≤ 10` OR `GRAPHIFY_STATE != "ready"`: skip the AskUserQuestion and continue to identify_scope (single-dispatch path). The community-filter is the canonical fallback when scope creeps past 10 files without graphify.

If `SCOPE_FILE_COUNT > 10` AND `GRAPHIFY_STATE == "ready"`: ask the user:

```yaml
question: "Review scope is {SCOPE_FILE_COUNT} files. Split into parallel lanes (one reviewer per graphify community, capped at 5)?"
header: "Parallel Review"
multiSelect: false
options:
  - label: "Yes — parallel lanes (recommended for >15 files)"
    description: "Foreground multi-Task dispatch by community; substance-gated per lane; consolidated into single review.md"
  - label: "No — single dispatch with community-filter"
    description: "One reviewer; deep review restricted to affected_communities; rest deferred"
```

If user picks YES: delegate to `workflows/code-review-parallel.md` by Read-ing that file and following its steps starting from `context_init`. The cached workflow.yaml state (workflow_id, memory_signal, scope_hint, scope_trust) carries over — the parallel workflow re-reads it.

If user picks NO: continue to identify_scope (existing single-dispatch path; the code-reviewer agent's community-filter logic handles scope > 10 files automatically).

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=scope_check status=DONE
```

</step>
```

- [ ] **Step 3: Commit**

```bash
cd /Users/emrec/Projects/devt
git add workflows/code-review.md
git commit -m "feat(workflows): add scope_check step + parallel-lane AskUserQuestion at >10 files"
```

---

## Phase 5 — Smoke gates (12 from spec: F32-F37 + 6 supporting)

### Task 13: Add F32 + F33 gates (threshold + partition)

**Files:**
- Modify: `scripts/smoke-test.sh` (append gates just before the final `== Result ==` echo)

- [ ] **Step 1: Find the insertion point**

```bash
grep -n 'echo "== Result' /Users/emrec/Projects/devt/scripts/smoke-test.sh | tail -1
```

- [ ] **Step 2: Insert the F32 + F33 gates just before that line**

```bash
# Append the following block just before `echo "== Result: ${PASS} passed, ${FAIL} failed =="`
# Use Edit tool to insert; do not run as a heredoc because the smoke script uses sentinel-bash style.
```

In Edit, replace the existing line:
```
echo
echo "== Result: ${PASS} passed, ${FAIL} failed =="
[[ $FAIL -eq 0 ]]
```

with:
```bash
# F32 — scope_check step routes by file count + AskUserQuestion presence.
# F32a: presence — code-review.md contains a scope_check step that gates on >10 files
if /usr/bin/grep -q '<step name="scope_check"' "$ROOT/workflows/code-review.md" \
  && /usr/bin/grep -q "AskUserQuestion" "$ROOT/workflows/code-review.md"; then
  pass "F32a: code-review.md has scope_check step with AskUserQuestion (parallel-lane gate)"
else
  fail "F32a: code-review.md missing scope_check step or AskUserQuestion"
fi
# F32b: the file-count threshold is the canonical 10 (matches community-filter trigger)
if /usr/bin/grep -qE 'SCOPE_FILE_COUNT.*(>|gt).*10|files > 10|10 files' "$ROOT/workflows/code-review.md"; then
  pass "F32b: code-review.md uses the canonical >10 file threshold for parallel-lane offer"
else
  fail "F32b: parallel-lane threshold is not the canonical 10"
fi

# F33 — partition_lanes caps at 5 + falls back when graphify unavailable.
if /usr/bin/grep -qE 'head -5|cap.*5 lanes' "$ROOT/workflows/code-review-parallel.md"; then
  pass "F33a: code-review-parallel.md partition_lanes caps at 5"
else
  fail "F33a: partition_lanes does not cap at 5 lanes"
fi
if /usr/bin/grep -qE 'FALLBACK.*graphify|graph-impact.md absent|routing.*single-dispatch' "$ROOT/workflows/code-review-parallel.md"; then
  pass "F33b: code-review-parallel.md falls back to single-dispatch when graphify unavailable"
else
  fail "F33b: graphify-unavailable fallback missing in partition_lanes"
fi

echo
echo "== Result: ${PASS} passed, ${FAIL} failed =="
[[ $FAIL -eq 0 ]]
```

- [ ] **Step 3: Run smoke to verify both gates pass**

```bash
bash /Users/emrec/Projects/devt/scripts/smoke-test.sh 2>&1 | grep -E "F32|F33"
```
Expected: 4 PASS lines (F32a, F32b, F33a, F33b).

- [ ] **Step 4: Commit**

```bash
cd /Users/emrec/Projects/devt
git add scripts/smoke-test.sh
git commit -m "test(smoke): F32+F33 — scope_check threshold + partition_lanes cap/fallback"
```

---

### Task 14: Add F34 + F36 gates (per-lane F28 + L1 re-dispatch compliance)

**Files:**
- Modify: `scripts/smoke-test.sh` (append to F33 block)

- [ ] **Step 1: Insert the F34 + F36 gates just before the final `== Result ==` echo**

Edit the file: insert after the F33 gates and before the final `echo "== Result..."`:

```bash
# F34 — per-lane F28 substance check + retry-once-then-defer.
# F34a: presence — substance_check_lanes step exists and calls check-agent-output
if /usr/bin/grep -q '<step name="substance_check_lanes"' "$ROOT/workflows/code-review-parallel.md" \
  && /usr/bin/grep -q "state check-agent-output" "$ROOT/workflows/code-review-parallel.md"; then
  pass "F34a: code-review-parallel.md substance_check_lanes loops state check-agent-output per lane"
else
  fail "F34a: substance_check_lanes step missing or does not invoke check-agent-output"
fi
# F34b: retry-once-then-defer — state transitions in_flight → stub_redispatched → deferred
if /usr/bin/grep -q 'status=stub_redispatched' "$ROOT/workflows/code-review-parallel.md" \
  && /usr/bin/grep -q 'status=deferred' "$ROOT/workflows/code-review-parallel.md" \
  && /usr/bin/grep -qE 'REDISPATCH_COUNT.*1|redispatch_count.*ge 1' "$ROOT/workflows/code-review-parallel.md"; then
  pass "F34b: retry-once-then-defer policy wired (stub_redispatched on first, deferred on second)"
else
  fail "F34b: retry-once-then-defer policy not implemented"
fi

# F36 — re-dispatch carries all three L1-required context blocks.
# F36a: redispatch_lanes step references the same context-block injection idiom as dispatch_lanes
if /usr/bin/grep -q '<step name="redispatch_lanes"' "$ROOT/workflows/code-review-parallel.md" \
  && /usr/bin/grep -q "scope_trust" "$ROOT/workflows/code-review-parallel.md" \
  && /usr/bin/grep -q "scope_hint" "$ROOT/workflows/code-review-parallel.md" \
  && /usr/bin/grep -q "memory_signal" "$ROOT/workflows/code-review-parallel.md"; then
  pass "F36a: redispatch_lanes carries scope_trust + scope_hint + memory_signal (L1 compliance)"
else
  fail "F36a: redispatch_lanes missing one or more L1-required context blocks"
fi
# F36b: code-review.md and code-review-parallel.md both call the same governing-rules + memory-signal CLIs
if /usr/bin/grep -q "memory query.*--signal=3\|memory_signal_json" "$ROOT/workflows/code-review.md" \
  && /usr/bin/grep -q "memory_signal_json" "$ROOT/workflows/code-review-parallel.md"; then
  pass "F36b: code-review.md and code-review-parallel.md share governing context-prep idioms"
else
  fail "F36b: parallel workflow does not mirror code-review.md context-prep contract"
fi
```

- [ ] **Step 2: Run smoke**

```bash
bash /Users/emrec/Projects/devt/scripts/smoke-test.sh 2>&1 | grep -E "F34|F36"
```
Expected: 4 PASS lines.

- [ ] **Step 3: Commit**

```bash
cd /Users/emrec/Projects/devt
git add scripts/smoke-test.sh
git commit -m "test(smoke): F34+F36 — per-lane substance check + L1 re-dispatch compliance"
```

---

### Task 15: Add F35 + F37 gates (consolidator + edge cases)

**Files:**
- Modify: `scripts/smoke-test.sh`

- [ ] **Step 1: Insert the F35 + F37 gates just before the final `== Result ==` echo**

```bash
# F35 — consolidator step + synthesis-mode handler.
# F35a: code-review-parallel.md has a consolidate step that invokes code-reviewer
if /usr/bin/grep -q '<step name="consolidate"' "$ROOT/workflows/code-review-parallel.md" \
  && /usr/bin/grep -q "Synthesize the N lane review files" "$ROOT/workflows/code-review-parallel.md"; then
  pass "F35a: code-review-parallel.md consolidate step dispatches code-reviewer with synthesis instruction"
else
  fail "F35a: consolidate step missing or does not use the synthesis task instruction"
fi
# F35b: code-reviewer agent body carries the synthesis-mode handler
if /usr/bin/grep -q "Lane synthesis mode" "$ROOT/agents/code-reviewer.md" \
  && /usr/bin/grep -q "Dedupe findings" "$ROOT/agents/code-reviewer.md" \
  && /usr/bin/grep -q "Lane Provenance" "$ROOT/agents/code-reviewer.md"; then
  pass "F35b: agents/code-reviewer.md carries lane synthesis-mode handler"
else
  fail "F35b: code-reviewer agent body missing lane synthesis-mode handler"
fi

# F37 — edge cases: hard-defer impossibly-fast empty returns + all-deferred handling.
if /usr/bin/grep -qE "LANE_SIZE.*-lt 30|hard.defer|harness failure" "$ROOT/workflows/code-review-parallel.md"; then
  pass "F37a: code-review-parallel.md hard-defers impossibly-fast empty lane returns (< 30 bytes)"
else
  fail "F37a: impossibly-fast lane hard-defer not implemented"
fi
if /usr/bin/grep -q "All Lanes Failed\|DEFERRED_COUNT" "$ROOT/workflows/code-review-parallel.md" \
  && /usr/bin/grep -q "All Lanes Failed" "$ROOT/agents/code-reviewer.md"; then
  pass "F37b: all-lanes-deferred case produces review.md with ## All Lanes Failed + verdict=failed"
else
  fail "F37b: all-lanes-deferred handling incomplete in workflow or agent body"
fi
```

- [ ] **Step 2: Run smoke**

```bash
bash /Users/emrec/Projects/devt/scripts/smoke-test.sh 2>&1 | grep -E "F35|F37"
```
Expected: 4 PASS lines.

- [ ] **Step 3: Commit**

```bash
cd /Users/emrec/Projects/devt
git add scripts/smoke-test.sh
git commit -m "test(smoke): F35+F37 — consolidator synthesis mode + edge-case defer handling"
```

---

## Phase 6 — Docs sync + release

### Task 16: Update CLAUDE.md, STATE-RULES.md, AGENT-CONTRACTS.md

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/STATE-RULES.md`
- Modify: `docs/AGENT-CONTRACTS.md`

- [ ] **Step 1: Update CLAUDE.md Development Commands block**

Find the existing `node bin/devt-tools.cjs state ...` block (around line 93-99) and add the two new subcommands:

```
node bin/devt-tools.cjs state list-lane-outputs # Read workflow.yaml::lanes[] registry with per-lane file existence + size
node bin/devt-tools.cjs state update-lane <id> status=<status> # Mutate a single lane's status (substance_pass | stub_redispatched | deferred)
```

Also update the `workflow_type Registry` table further down — add a row:

```
| `code_review_parallel` | `code-review-parallel.md` | `/devt:review` (re-routes via scope_check) |
```

- [ ] **Step 2: Update docs/STATE-RULES.md**

Find the filename pattern section. Add an entry for the lane file pattern:

```
- `review-lane-<slug>.md` — per-lane review output from code-review-parallel.md. Slug pattern: `[a-z][a-z0-9_]{0,31}` (computed via `state.cjs::slugifyLaneName`). Multiple files allowed per workflow run. Not RESET_EXEMPT.
```

- [ ] **Step 3: Update docs/AGENT-CONTRACTS.md "EXACTLY ONE dispatch" rule**

Find the section that states "EXACTLY ONE Task(subagent_type=\"devt:code-reviewer\", …) dispatch". Add a note immediately below acknowledging the sanctioned exception:

```
**Sanctioned exception**: `workflows/code-review-parallel.md` dispatches N code-reviewers in foreground parallel (single message, multi-Task) when scope > 10 files AND the user opts in via AskUserQuestion. The parallel workflow inherits the same context-block contract (scope_trust + scope_hint + memory_signal injected per dispatch); the L1 dispatch-hygiene hook accepts all lane Task() calls. Substance gates per-lane (F28 via state check-agent-output) and a consolidator dispatch enforce the same quality bar. Orchestrator improvisation OUTSIDE this workflow remains prohibited.
```

- [ ] **Step 4: Sanity-check no version refs were introduced**

```bash
grep -nE "v0\.[0-9]+\.[0-9]+|\bsince v[0-9]" /Users/emrec/Projects/devt/CLAUDE.md /Users/emrec/Projects/devt/docs/STATE-RULES.md /Users/emrec/Projects/devt/docs/AGENT-CONTRACTS.md | head -5
```
Expected: only pre-existing matches (not new ones).

- [ ] **Step 5: Commit**

```bash
cd /Users/emrec/Projects/devt
git add CLAUDE.md docs/STATE-RULES.md docs/AGENT-CONTRACTS.md
git commit -m "docs: sync CLAUDE.md + STATE-RULES.md + AGENT-CONTRACTS.md for code-review-parallel"
```

---

### Task 17: VERSION bump + CHANGELOG section + plugin.json

**Files:**
- Modify: `VERSION`
- Modify: `.claude-plugin/plugin.json`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Bump VERSION**

```bash
echo "0.59.0" > /Users/emrec/Projects/devt/VERSION
```

- [ ] **Step 2: Bump plugin.json**

Use Edit to change `"version": "0.58.4"` → `"version": "0.59.0"` in `.claude-plugin/plugin.json`.

- [ ] **Step 3: Add CHANGELOG entry**

In `CHANGELOG.md`, find the `## [Unreleased]` line and insert this section directly below it (before `## [0.58.4]`):

```markdown
## [0.59.0] - 2026-05-27

**Parallel-lane code review as a first-class workflow.** Closes deferred backlog item L5 from the dispatch-hygiene release. Triggered from `/devt:review` via `AskUserQuestion` when scope > 10 files. Foreground multi-Task dispatch (Anthropic-canonical idiom); community-aware partitioning capped at 5 lanes; F28 substance gates per-lane with retry-once-then-defer; canonical re-dispatch template closes L1 hook compliance; consolidator runs code-reviewer in synthesis mode. Inherits the full substance-enforcement layer from the prior dispatch-hygiene release. Smoke: **629 → 641 passed**, **0 failed** (+12 new gates).

### Added

- **`workflows/code-review-parallel.md`** — new workflow body covering context_init, partition_lanes (community-based, cap 5), dispatch_lanes (foreground multi-Task), substance_check_lanes, redispatch_lanes (canonical L1-compliant re-dispatch template), consolidate (synthesis dispatch), verify + present_findings (KEEP-IN-SYNC with code-review.md).
- **`agents/code-reviewer.md` synthesis-mode handler** — when dispatch task instruction begins with "Synthesize the N lane review files", agent dedupes findings by (file:line:finding_class), reconciles severity via rubric, preserves Critical findings, groups by file, emits `## Lane Provenance` section.
- **`workflows/code-review.md::scope_check` step** — measures file count; when > 10 AND graphify ready, surfaces `AskUserQuestion` offering parallel-lane review with single-dispatch+community-filter as the alternative.
- **2 new state CLI subcommands**:
  - `state list-lane-outputs` — parses `workflow.yaml::lanes[]` and returns per-lane existence + size
  - `state update-lane <id> status=<status>` — mutates a single lane's status, validated against `VALID_LANE_STATUSES`
- **`code_review_parallel` workflow_type** registered in `VALID_WORKFLOW_TYPES` + routed in `next.md` + `status.md`.
- **12 new smoke gates**: F32a/b (scope_check + threshold), F33a/b (partition cap + fallback), F34a/b (per-lane substance + retry-defer), F35a/b (consolidator + synthesis handler), F36a/b (L1 re-dispatch + KEEP-IN-SYNC), F37a/b (impossibly-fast hard-defer + all-deferred handling).

### Why foreground dispatch

Field signal (the multi-lane fan-out case from the dispatch-hygiene release): background dispatch + "no-polling-rule" stalled the main thread waiting for agents that never returned. Foreground multi-Task in one message is Anthropic-canonical for true parallelism — each agent bounded by `maxTurns: 40` (natural timeout), all results arrive synchronously (no polling required), consolidator gets everything at once. The same pattern devt already uses for researcher+architect parallel in `dev-workflow.md`.

### Not in this release (deferred)

- Auto-trigger without AskUserQuestion (user-opt-in design preserved).
- Per-lane verifiers (single verifier on consolidated review is simpler; field signal for needing per-lane grading not yet observed).
- Multi-lane patterns for `dev-workflow.md` (no field signal for multi-programmer flows).
- Lane partitioning strategies other than community (file-bucket + directory rejected during brainstorming).
```

- [ ] **Step 4: Verify the extractor finds the new section**

```bash
bash /Users/emrec/Projects/devt/scripts/extract-changelog.sh 0.59.0 2>&1 | head -3
```
Expected: the first line of the new section prints.

- [ ] **Step 5: Run the full smoke suite**

```bash
bash /Users/emrec/Projects/devt/scripts/smoke-test.sh 2>&1 | tail -3
```
Expected: `== Result: 641 passed, 0 failed ==`.

If FAIL count is non-zero, STOP and surface the failures — do not commit a red smoke.

- [ ] **Step 6: Commit + tag**

```bash
cd /Users/emrec/Projects/devt
git add VERSION .claude-plugin/plugin.json CHANGELOG.md
git commit -m "$(cat <<'EOF'
feat(workflows): v0.59.0 — code-review-parallel for multi-lane reviews

First-class parallel-lane review workflow. Triggered from /devt:review via
AskUserQuestion when scope > 10 files. Foreground multi-Task dispatch
(Anthropic-canonical), community-aware partitioning capped at 5, F28
substance gates per-lane with retry-once-then-defer, canonical L1-compliant
re-dispatch, consolidator runs code-reviewer in synthesis mode.

Closes deferred backlog item L5. Builds on substance-enforcement gates from
the prior dispatch-hygiene release.

Smoke: 629 → 641 passed, 0 failed (+12 gates: F32-F37).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git tag v0.59.0
git log -1 --oneline
```

---

## Self-Review checklist (run after all tasks complete)

- [ ] All 12 spec smoke gates implemented (F32a/b + F33a/b + F34a/b + F35a/b + F36a/b + F37a/b)
- [ ] `code_review_parallel` workflow_type appears in VALID_WORKFLOW_TYPES + next.md + status.md
- [ ] `state list-lane-outputs` + `state update-lane` are documented in CLAUDE.md
- [ ] `review-lane-<slug>.md` pattern is documented in STATE-RULES.md
- [ ] AGENT-CONTRACTS.md "EXACTLY ONE dispatch" rule notes the sanctioned parallel exception
- [ ] code-review-parallel.md's verify step is a KEEP-IN-SYNC copy of code-review.md::verify
- [ ] code-reviewer.md synthesis-mode handler exists and is referenced by the consolidate step's task instruction
- [ ] No new version refs (`v0.X.Y`, `since v0.A.B`) in any modified file outside CHANGELOG.md
- [ ] Byte-stability lint: no `$(date …)` or `Date.now()` in agent/workflow prose outside code fences
- [ ] Final smoke: `bash scripts/smoke-test.sh` → 641 passed, 0 failed
- [ ] Final commit + tag: `git log -1 --oneline` shows `v0.59.0`

---

## Open implementation decisions resolved in this plan

The spec deferred 4 implementation decisions to this phase. Decisions made:

1. **Verify step**: DUPLICATE from code-review.md::verify with `KEEP-IN-SYNC` marker. devt's workflow loader does not support partial-file include. Smoke gate F36b enforces shared idioms.
2. **Lane slug normalization**: lowercase, alphanum→underscore, collapse + trim, cap 32 chars. Implemented as `slugifyLaneName(name)` in state.cjs.
3. **`update-lane` CLI shape**: `state update-lane <lane-id> status=<status>` (positional id + `key=value` pairs) — matches existing `state update key=value` idiom.
4. **Synthesis-mode dispatch context size**: Read-on-demand from agent. The consolidator dispatch carries lane file PATHS in `<lane_files>` block (one per line); the agent Reads them. Avoids huge prompts and matches existing "agent Reads from .devt/state/" pattern.
