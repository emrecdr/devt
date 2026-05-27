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

**Note**: `workflow_type=code_review_parallel` must be added to `VALID_WORKFLOW_TYPES` in `bin/modules/state.cjs` AND routed in `workflows/next.md` + `workflows/status.md` (handled in Task 10 + Task 11).

</step>

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
COMMUNITIES_RAW=$(awk '/^## Affected Communities/{found=1; next} found && /^## /{exit} found{print}' "$GRAPH_IMPACT_PATH" | grep -E '^- ' | sed 's/^- //' | head -5)
COMMUNITY_COUNT=$(echo "$COMMUNITIES_RAW" | grep -cE '.')

if [ "$COMMUNITY_COUNT" -eq 0 ]; then
  echo "FALLBACK: graph-impact.md has no affected_communities — routing to single-dispatch + community-filter"
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=context_init status=DONE workflow_type=code_review
  exit 0
fi

# Build the lanes[] YAML block. Slug normalization happens via the CLI helper.
LANE_NUM=1
echo "$COMMUNITIES_RAW" | while IFS= read -r COMMUNITY; do
  [ -z "$COMMUNITY" ] && continue
  TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  SLUG=$(COMMUNITY_NAME="$COMMUNITY" node -e "const {slugifyLaneName} = require('${CLAUDE_PLUGIN_ROOT}/bin/modules/state.cjs'); console.log(slugifyLaneName(process.env.COMMUNITY_NAME))")
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
yaml = yaml.replace(/\nlanes:(\n[ \t][^\n]*)*/g, "");
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
