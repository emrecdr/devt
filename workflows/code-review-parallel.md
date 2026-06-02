---
description: Parallel-lane code review — partitions scope by graphify community, dispatches N lanes in foreground parallel, consolidates outputs. Delegated to from /devt:review when scope > 10 files AND user opts in via AskUserQuestion. Inherits all gates from code-review.md.
allowed-tools: Read, Bash, Glob, Grep, Task, AskUserQuestion
argument-hint: "<scope-description>"
---

# Parallel-Lane Code Review Workflow

> **KEEP IN SYNC**: This workflow re-uses the same context_init payload + verify step as `workflows/code-review.md`. When you change one, audit the other. Smoke gate F36b enforces that both files share the same governing_rules / memory_signal / scope_trust prep idioms.

This workflow is invoked from `code-review.md::scope_check` when the review scope exceeds 10 files AND the user opts into parallel via `AskUserQuestion`. It is NOT a user-facing slash command — there is no `/devt:review-parallel`; the routing is internal to `/devt:review`.

---

<prerequisites>
- `.devt/config.json` exists in project root (run `/init` first if not)
- `.devt/rules/` directory exists with project conventions
- `${CLAUDE_PLUGIN_ROOT}` is set (devt plugin is loaded)
- `node` is available on PATH
- `workflows/code-review.md::scope_check` has already routed here via `AskUserQuestion` → user picked parallel
- `.devt/state/workflow.yaml::workflow_type` is `code_review_parallel` (set during delegation)
</prerequisites>

<available_agent_types>
The following agent type is used in this workflow:

- `devt:code-reviewer` — code review specialist, READ-ONLY (Read, Bash, Glob, Grep). Used for both per-lane reviews AND the consolidator (synthesis-mode) dispatch.

Not used in this workflow:

- `devt:programmer` — implementation specialist
- `devt:tester` — testing specialist
- `devt:architect` — structural review specialist
- `devt:docs-writer` — documentation specialist
- `devt:retro` — lesson extraction specialist
- `devt:curator` — playbook quality maintenance specialist
- `devt:verifier` — used by the inherited verify step from code-review.md (KEEP IN SYNC)
  </available_agent_types>

<agent_skill_injection>
Before dispatching the code-reviewer agent (both per-lane and consolidator), check `.devt/config.json` for an `agent_skills` configuration block:

```json
{
  "agent_skills": {
    "code-reviewer": ["code-review-guide"]
  }
}
```

If `agent_skills.code-reviewer` exists, inject the skill references into the agent's prompt context — same idiom as `code-review.md` single-dispatch path. Apply uniformly to every per-lane dispatch AND the consolidator synthesis-mode dispatch so all dispatches have the same skill surface.

If not configured, omit the block.
</agent_skill_injection>

---

## Steps

<step name="context_init" gate="compound init succeeds + lane partition computed">

**MCP-setup inheritance architecture (B-X).** This workflow is dispatched AFTER `code-review.md::context_init` has already run its full 8-substep setup — including the Graphify impact-plan, F16 multi-tier drill-down, F17 god-node check, and claude-mem MCP harvest. The result is `.devt/state/graph-impact.md` + cached `workflow.yaml::memory_signal_json` / `scope_hint_json` / `scope_trust_json`. Lanes consume those READ-ONLY through the dispatch templates below — they do NOT run their own MCP calls. Greenfield audit flagged this as "0 functional MCP calls" — that observation is correct but the architecture is intentional: lanes are MCP-blind by design (per CLAUDE.md::Critical Agent + Workflow Contracts), and graph-impact.md is the orchestrator-mediated handoff that gives lanes the same blast-radius context without each lane re-querying the graph. The single-source preparation also keeps trace records / correlation_ids consistent across all lanes of one review.

When this workflow is dispatched WITHOUT a prior `code-review.md::context_init` run (e.g., direct invocation in tests), `STATE.memory_signal_json` will be empty `"{}"`. That's a graceful degradation — lanes still dispatch, just without inherited MCP context — but the orchestrator should re-route to `code-review.md` first when the cached fields are empty AND the project has graphify enabled.

Initialize the workflow (delegated from code-review.md; the upstream step already wrote workflow.yaml::active=true and ran preflight + memory_signal cache). Re-read the cached context blocks:

```bash
# Re-derive scope_trust from current preflight-brief.json so the cached value reflects current graph state, not the value computed at workflow start. Fail-open: stale cache used if no brief.
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state refresh-scope-context >/dev/null 2>&1 || true
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

<step name="partition_lanes" gate="lanes[] registered via state update-lane OR fallback to single-dispatch">

Partition scope files into lanes. Community-first when graphify is enabled AND the graph has community attributes (B-XIII), otherwise falls back to top-level directory path grouping. The `graphify lane-suggestions` CLI returns `mode: "community"` with per-file dominant-community grouping when usable, or `mode: "fallback"` when the graph is missing / has no community labels / leaves diff files uncovered. The fallback case is the legacy path partition — field-validated when graphify's blast_radius response doesn't emit community labels (greenfield's graph-impact.md had zero `## Affected Communities` sections after a 58-file blast_radius call). The orchestrator does not pick between modes — the CLI decides and the bash branch routes.

```bash
SCOPE_FILES_PATH=".devt/state/code-review-input.md"
if [ ! -f "$SCOPE_FILES_PATH" ]; then
  echo "FALLBACK: code-review-input.md absent — routing to single-dispatch"
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=context_init status=DONE workflow_type=code_review
  exit 0
fi

# Read scope files (one path per line, skip blanks + comments)
SCOPE_FILES=$(/usr/bin/grep -vE '^#|^$' "$SCOPE_FILES_PATH" 2>/dev/null || echo "")
SCOPE_FILE_COUNT=$(echo "$SCOPE_FILES" | /usr/bin/grep -cE '.' || echo 0)
if [ "$SCOPE_FILE_COUNT" -eq 0 ]; then
  echo "FALLBACK: zero scope files — routing to single-dispatch"
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=context_init status=DONE workflow_type=code_review
  exit 0
fi

# B-XIII: try community-first partition. lane-suggestions returns mode=community
# with per-file dominant-community grouping when the graph has community
# attributes from Leiden clustering. Otherwise mode=fallback and the bash
# branch below uses the legacy top-2-level path partition.
LANE_SUG=$(echo "$SCOPE_FILES" | tr '\n' ' ' | xargs node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" graphify lane-suggestions --target-lanes=5 2>/dev/null || echo '{"mode":"fallback"}')
LANE_MODE=$(echo "$LANE_SUG" | jq -r '.mode // "fallback"')

GROUPS_FILE=$(mktemp)
if [ "$LANE_MODE" = "community" ] || [ "$LANE_MODE" = "partial" ]; then
  # Community partition: each group becomes one lane. The prefix label is
  # "community-N" for covered files; "ungrouped" for partial-mode uncovered
  # files (those without graph nodes — tests, migrations, docs). The
  # downstream slug generation handles both labels (NEW-6).
  echo "$LANE_SUG" | jq -r '.groups[] | (if .community == null then "ungrouped" else "community-" + (.community|tostring) end) as $c | .files[] | $c + "|" + .' | sort > "$GROUPS_FILE"
  if [ "$LANE_MODE" = "partial" ]; then
    COVERED=$(echo "$LANE_SUG" | jq -r '.covered_count')
    UNCOVERED=$(echo "$LANE_SUG" | jq -r '.uncovered_count')
    echo "partition_lanes: ${SCOPE_FILE_COUNT} files → partial community partition (covered: ${COVERED}, ungrouped: ${UNCOVERED}) (NEW-6)"
  else
    echo "partition_lanes: ${SCOPE_FILE_COUNT} files → community-driven partition (B-XIII)"
  fi
else
  # Fallback: group by top-2-level path (e.g., "src/auth/middleware.ts" →
  # "src/auth"). For flat layouts (single top-level), falls back to
  # top-1-level. Top-level files get "root".
  echo "$SCOPE_FILES" | while IFS= read -r FILE; do
    [ -z "$FILE" ] && continue
    PREFIX=$(echo "$FILE" | awk -F/ '{ if (NF >= 3) print $1"/"$2; else if (NF == 2) print $1; else print "root" }')
    echo "$PREFIX|$FILE"
  done | sort > "$GROUPS_FILE"
  FALLBACK_REASON=$(echo "$LANE_SUG" | jq -r '.reason // "graphify disabled"')
  echo "partition_lanes: ${SCOPE_FILE_COUNT} files → path-based partition (community fallback: ${FALLBACK_REASON})"
fi

UNIQUE_PREFIXES=$(cut -d'|' -f1 "$GROUPS_FILE" | sort -u)
PREFIX_COUNT=$(echo "$UNIQUE_PREFIXES" | /usr/bin/grep -cE '.')
echo "partition_lanes: ${PREFIX_COUNT} groups (cap=5 in next step)"

# Build lanes block. Each prefix becomes one lane. The lanes block is then
# injected into workflow.yaml (replacing any prior lanes: section).
# Per-lane sizing (B-VIII): file count + estimated LOC are computed so an
# oversized lane (> 15 files OR > 800 LOC) is flagged before dispatch. Field
# signal (greenfield calibration #3 finding #1): Lane C with 25 files /
# 1577 LOC consistently exhausted code-reviewer's maxTurns budget on both
# dispatches. The thresholds are heuristics validated against that case —
# tunable via .devt/config.json::workflow.lane_oversized_thresholds in
# future, hardcoded here for now.
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
LANE_NUM=1
OVERSIZED_COUNT=0
echo "$UNIQUE_PREFIXES" | head -5 | while IFS= read -r PREFIX; do
  [ -z "$PREFIX" ] && continue
  SLUG=$(PREFIX_NAME="$PREFIX" node -e "const {slugifyLaneName} = require('${CLAUDE_PLUGIN_ROOT}/bin/modules/state.cjs'); console.log(slugifyLaneName(process.env.PREFIX_NAME))")
  # Files belonging to this lane (filter the prefix-tagged groups file).
  LANE_FILES=$(awk -F'|' -v p="$PREFIX" '$1 == p { print $2 }' "$GROUPS_FILE")
  LANE_FILE_COUNT=$(echo "$LANE_FILES" | /usr/bin/grep -cE '.' || echo 0)
  # LOC: sum wc -l across existing files. Non-existent paths contribute 0.
  LANE_LOC=$(echo "$LANE_FILES" | while IFS= read -r f; do
    [ -z "$f" ] && continue
    [ -f "$f" ] && wc -l < "$f" 2>/dev/null || echo 0
  done | awk '{s+=$1} END {print s+0}')
  OVERSIZED="false"
  if [ "$LANE_FILE_COUNT" -gt 15 ] || [ "$LANE_LOC" -gt 800 ]; then
    OVERSIZED="true"
    OVERSIZED_COUNT=$((OVERSIZED_COUNT + 1))
    echo "WARN: lane L${LANE_NUM} (${PREFIX}) oversized — ${LANE_FILE_COUNT} files / ${LANE_LOC} LOC exceeds 15/800 threshold; may exhaust maxTurns budget" >&2
  fi
  echo "  - id: \"L${LANE_NUM}\""
  echo "    community: \"${PREFIX}\""
  echo "    slug: \"${SLUG}\""
  echo "    review_file: \".devt/state/review-lane-${SLUG}.md\""
  echo "    status: \"in_flight\""
  echo "    redispatch_count: 0"
  echo "    dispatched_at: \"${TS}\""
  echo "    file_count: ${LANE_FILE_COUNT}"
  echo "    est_loc: ${LANE_LOC}"
  echo "    oversized: ${OVERSIZED}"
  LANE_NUM=$((LANE_NUM + 1))
done > /tmp/devt-lanes-block.yaml

node -e '
const fs = require("fs");
const path = ".devt/state/workflow.yaml";
let yaml = fs.readFileSync(path, "utf8");
yaml = yaml.replace(/\nlanes:(\n[ \t][^\n]*)*/g, "");
const lanesBlock = "lanes:\n" + fs.readFileSync("/tmp/devt-lanes-block.yaml", "utf8");
fs.writeFileSync(path, yaml.trimEnd() + "\n" + lanesBlock);
'
rm -f /tmp/devt-lanes-block.yaml "$GROUPS_FILE"

LANES_OUT=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state list-lane-outputs)
LANE_COUNT=$(echo "$LANES_OUT" | jq '.lanes | length')
echo "Partitioned into ${LANE_COUNT} lanes (path-based, cap=5)"
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=partition_lanes status=DONE
```

**Oversized-lane surface (B-VIII)**: when any lane carries `oversized: true` in `workflow.yaml::lanes[]`, surface a one-line summary to the user with paths-based remediation hints. The orchestrator may proceed (the dispatch will still attempt the lane) or use AskUserQuestion to offer narrowing — see the AskUserQuestion block below. Field signal: greenfield Lane C with 25 files / 1577 LOC consistently hit the maxTurns ceiling before findings could be written.

```bash
OVERSIZED_LANES=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state list-lane-outputs | \
  jq -r '.lanes[] | select(.oversized == true) | "  - " + .id + " (" + .community + "): " + (.file_count|tostring) + " files / " + (.est_loc|tostring) + " LOC"')
if [ -n "$OVERSIZED_LANES" ]; then
  echo ""
  echo "⚠️ Oversized lane(s) detected — may exhaust code-reviewer maxTurns budget:"
  echo "$OVERSIZED_LANES"
  echo ""
  echo "Consider: (1) split the review into multiple PRs, (2) restrict scope via /devt:review --scope=<subset>, or (3) proceed and accept that oversized lanes may produce DONE_WITH_CONCERNS verdicts when budget runs out."
fi
```

**Gate**: When zero lanes were registered (empty scope or path bucketing failed), the step routes back to the single-dispatch path. The parallel workflow only proceeds when ≥ 1 lane is in `workflow.yaml::lanes[]` — the next step (dispatch_lanes) enforces this via `state assert-lanes-registered`.

</step>

<step name="dispatch_lanes" gate="all lane Task() calls returned in a single foreground batch">

**Foreground parallel dispatch.** Issue ONE message containing N `Task(subagent_type="devt:code-reviewer", …)` calls — one per lane in `workflow.yaml::lanes[]`. Sequential Task calls serialize; only multi-Task-in-one-message gets true parallelism per the Anthropic Task contract (same idiom as `dev-workflow.md:506` researcher+architect parallel dispatch).

```bash
LANES_GATE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-lanes-registered)
if echo "$LANES_GATE" | jq -e '.ok == false' >/dev/null 2>&1; then
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=dispatch_lanes status=BLOCKED verdict=FAILED
  echo "BLOCKED: $(echo "$LANES_GATE" | jq -r '.reason')"
  exit 0
fi
LANE_COUNT=$(echo "$LANES_GATE" | jq -r '.lane_count')
echo "dispatch_lanes: ${LANE_COUNT} lanes registered"
```

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
- `<rubric_path>references/rubrics/{rubrics.code_review}</rubric_path>` (C7-7)
- `<rubric_content>{inline_rubrics.code_review}</rubric_content>` (C7-7 — same axes the verifier will grade against; lane reviewer self-checks axes A–D + G for its file slice)

**L1-v2 (greenfield calibration #11) — prose-only lane cache suppression.** When ALL files in `<lane_files>` have a prose extension (`.md`, `.rst`, `.txt`, `.adoc`), the orchestrator MUST replace the `<graph_impact>` cache injection with a `<graphify_status>not_applicable</graphify_status>` stub instead of pasting `graph-impact.md` content. Greenfield calibration #11 L3 evidence: a prose-only README lane received the global preflight cache (`effect_size: large, god_node_match: true`) computed against the FULL PR scope including code files — pure noise for a markdown-only review. Detect via:
```bash
LANE_FILES_PROSE_ONLY=$(echo "$LANE_FILES_JSON" | jq -r 'all(. as $f | ["md","rst","txt","adoc"] | any($f | test("\\.\(.)$"; "i")))' 2>/dev/null || echo "false")
```
When `LANE_FILES_PROSE_ONLY=true`, inject a stub `<graph_impact>not_applicable: prose-only lane — graphify cache suppressed (no AST relationships on prose files)</graph_impact>` and omit `<scope_hint>` (or set it to the lane's own file list). Respects the MCP-blind lane contract — the orchestrator filters per-lane, lanes never query graphify themselves.

Task instruction: `Review the files listed in <lane_files>. Write your review to <output_path>. Do NOT review files outside the lane. Use the substance-first protocol — write the stub on first turn, then iterate.`

Output path: each lane's `review_file` from the registry.

**Issue all N Task() calls in ONE message.** Example for 3 lanes:

```
Task(subagent_type="devt:code-reviewer", model="{models.code_reviewer}", prompt="<context>...<lane_id>L1</lane_id>...</context><task>Review the files listed in <lane_files>. Write your review to .devt/state/review-lane-auth_subgraph.md.</task>")
Task(subagent_type="devt:code-reviewer", model="{models.code_reviewer}", prompt="<context>...<lane_id>L2</lane_id>...</context><task>Review the files listed in <lane_files>. Write your review to .devt/state/review-lane-billing_subgraph.md.</task>")
Task(subagent_type="devt:code-reviewer", model="{models.code_reviewer}", prompt="<context>...<lane_id>L3</lane_id>...</context><task>Review the files listed in <lane_files>. Write your review to .devt/state/review-lane-payments.md.</task>")
```

When all Task() calls return (foreground blocks until all complete — each agent bounded by its `maxTurns` frontmatter), proceed to substance_check_lanes.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=dispatch_lanes status=DONE
```

</step>

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
  # grep -F avoids jq parse failure: stub_phrases_found[] contains raw regex
  # source strings with unescaped backslashes (\b, \s) that are invalid JSON.
  if echo "$RESULT" | grep -qF '"looks_like_stub":true'; then
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

For each lane with `status=stub_redispatched`, issue ONE re-dispatch with a NARROWED prompt. Identical re-dispatch (same prompt, same scope) wastes budget — greenfield calibration #3 finding #2: "On stub-retry, identical re-dispatch wastes budget; ask for '5 highest-signal findings only' trades completeness for substance." Increment `redispatch_count` BEFORE the Task() call so the next substance_check_lanes pass correctly routes a second stub to deferred.

```bash
LANES_JSON=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state list-lane-outputs)
for LANE_ID in $(echo "$LANES_JSON" | jq -r '.lanes[] | select(.status == "stub_redispatched") | .id'); do
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update-lane "$LANE_ID" redispatch_count=1
done
```

**Narrowed redispatch prompt template (B-IX)** — issue ONE message with N Task() calls (one per stub_redispatched lane), using ALL the same context blocks (`<scope_trust>`, `<scope_hint>`, `<memory_signal>`, `<lane_id>`, `<lane_files>`, etc. — every L1-required block from dispatch_lanes) BUT replace the `<task>` instruction with the scoped form below. The output file path stays identical so consolidate picks up the new content.

```text
<task>SCOPED REDISPATCH (1/1 retry budget): the prior dispatch returned stub-quality output (substance check failed). Re-review the files listed in <lane_files>, but constrain scope to the **5 highest-signal findings only** — pick the issues whose severity × blast-radius is greatest, write a substantive `## Finding N: <title>` block for each (description, evidence, remediation), and explicitly drop everything else. The full file path coverage of the prior dispatch is NOT required this time. Write to <review_file_for_this_lane>. Cap the markdown at ~4 KB.</task>
```

Why this works: oversized + low-information lanes hit maxTurns because the agent tries to cover everything shallowly. Constraining to top-5 lets the limited budget produce substantive findings on the issues that actually matter. The orchestrator's `## Out-of-Scope Findings (Deferred)` synthesis step (consolidate) already absorbs lanes that go deferred, so completeness loss here is intentional and bounded.

After all Task() calls return, re-run substance_check_lanes via the bash loop — but this time any lane that's still a stub gets `status=deferred` (the retry-once-then-defer terminal).

```bash
# Re-run the substance check loop (copy from substance_check_lanes step).
# Lanes with redispatch_count >= 1 that still look like stubs route to deferred.
LANES_JSON=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state list-lane-outputs)
for LANE_ID in $(echo "$LANES_JSON" | jq -r '.lanes[] | select(.status == "stub_redispatched") | .id'); do
  LANE_FILE=$(echo "$LANES_JSON" | jq -r --arg id "$LANE_ID" '.lanes[] | select(.id == $id) | .review_file')
  RESULT=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state check-agent-output "$LANE_FILE")
  if echo "$RESULT" | grep -qF '"looks_like_stub":true'; then
    node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update-lane "$LANE_ID" status=deferred
  else
    node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update-lane "$LANE_ID" status=substance_pass
  fi
done
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=redispatch_lanes status=DONE
```

</step>

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
    <rubric_path>references/rubrics/{rubrics.code_review}</rubric_path>
    <rubric_content>{inline_rubrics.code_review}</rubric_content>
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
if echo "$SUBSTANCE" | /usr/bin/grep -qF '"looks_like_stub":true'; then
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=consolidate status=BLOCKED verdict=FAILED
  REASON=$(echo "$SUBSTANCE" | /usr/bin/grep -oE '"reason":"[^"]*"' || echo '"reason":"unknown"')
  echo "BLOCKED: consolidator returned stub — ${REASON}"
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
if echo "$SUBSTANCE" | /usr/bin/grep -qF '"looks_like_stub":true'; then
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=verify status=BLOCKED verdict=FAILED
  REASON=$(echo "$SUBSTANCE" | /usr/bin/grep -oE '"reason":"[^"]*"' || echo '"reason":"unknown"')
  echo "BLOCKED: consolidated review.md looks like a stub — ${REASON}"
  exit 0
fi
```

```bash
CONS_GATE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-consolidator-dispatched)
if echo "$CONS_GATE" | jq -e '.ok == false' >/dev/null 2>&1; then
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=verify status=BLOCKED verdict=FAILED
  echo "BLOCKED: $(echo "$CONS_GATE" | jq -r '.reason')"
  exit 0
fi
```

**Orchestrator-prep — read cached context blocks** (same as code-review.md::verify):

```bash
# Re-derive scope_trust from current preflight-brief.json so the cached value reflects current graph state, not the value computed at workflow start. Fail-open: stale cache used if no brief.
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state refresh-scope-context >/dev/null 2>&1 || true
STATE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state read)
MEMORY_SIGNAL=$(echo "$STATE" | jq -r '.memory_signal_json // "{}"')
SCOPE_HINT=$(echo "$STATE" | jq -r '.scope_hint_json // "[]"')
SCOPE_TRUST=$(echo "$STATE" | jq -r '.scope_trust_json // "{}"')
```

Dispatch the verifier:

```
Task(subagent_type="devt:verifier", model="{models.verifier}", prompt="
  <context>
    <workflow_type>code_review</workflow_type>
    <rubric_path>references/rubrics/{rubrics.code_review}</rubric_path>
    <rubric_content>{inline_rubrics.code_review}</rubric_content>
    <original_task>{review_scope_description}</original_task>
    <memory_signal>{memory_signal_json}</memory_signal>
    <scope_hint>{scope_hint_json}</scope_hint>
    <scope_trust>{scope_trust_json}</scope_trust>
    <governing_rules rules_hash=\"{governing_rules.rules_hash}\">
      <claude_md>{governing_rules.content[\"CLAUDE.md\"]}</claude_md>
      <quality_gates>{governing_rules.content[\".devt/rules/quality-gates.md\"]}</quality_gates>
      <review_checklist>{governing_rules.content[\".devt/rules/review-checklist.md\"]}</review_checklist>
    </governing_rules>
    <files_to_read>.devt/state/review.md, .devt/state/code-review-input.md</files_to_read>
    <impl_summary>Read .devt/state/impl-summary.md (if exists — code-review may follow an implementation phase)</impl_summary>
    <decisions>Read .devt/state/decisions.md (if exists)</decisions>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
  </context>
  <task>
    Grade the code review against the code_review rubric. You are NOT re-doing the review.
    Spot-check the review's thoroughness, specificity, severity calibration, and remediation
    concreteness using the rubric in <rubric_path>. Read review.md as the artifact under review.
    If axes fail, emit revisions[] keyed by axis-letter (A-1, B-3, etc.) for the reviewer to address.

    Cross-reference the review's remediation against `.devt/state/graph-impact.md` when present.
    The orchestrator wrote that file from upstream Graphify MCP during context_init. When the
    impact map lists high-blast-radius symbols or affected communities for findings the reviewer
    flagged, verify the remediation accounts for caller-set impact — propose a revision when a
    Critical finding ignores a documented structural risk. When `graphify-skip-reason.txt` exists,
    graph data is unavailable and structural-risk cross-checks do not apply.
  </task>
  Write verification to .devt/state/verification.md AND .devt/state/verification.json (sidecar).
")
```

**Gate check**: Read the structured sidecar `.devt/state/verification.json` for routing:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state read-sidecar verification.json
MAX_ITER=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" config get | jq -r '.workflow.max_iterations // 3')
VITER=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state read | jq -r '.verify_iteration // 0')
```

Route on `verdict`:

- **`verdict=satisfied`** (status=VERIFIED or DONE_WITH_CONCERNS): proceed to `present_findings`.
  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=verify status=DONE verdict=VERIFIED
  ```
- **`verdict=needs_revision`** (status=GAPS_FOUND) — apply the **repair operator**:
  - **`VITER < MAX_ITER` → RETRY**: re-dispatch the **code-reviewer** (consolidate step) with each `revisions[].gap` verbatim as `<reviewer_feedback>` in the prompt.
    ```bash
    node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=verify verify_iteration=$((VITER+1)) verdict=GAPS_FOUND repair=RETRY
    ```
  - **`VITER >= MAX_ITER` → PRUNE**: stop iterating. Write remaining `revisions[]` to `.devt/state/scratchpad.md` under `## Deferred Review Verification Gaps`. Proceed to `present_findings` with `status=DONE_WITH_CONCERNS`.
    ```bash
    node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=verify status=DONE_WITH_CONCERNS verdict=GAPS_FOUND repair=PRUNE
    ```
- **`verdict=failed`** (status=FAILED) — STOP with BLOCKED. Surface the verifier's failure reason to the user. No retry.
  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=verify status=BLOCKED verdict=FAILED
  ```

</step>

<step name="present_findings" gate="findings reported with lane provenance">

> **KEEP IN SYNC** with code-review.md::present_findings.

**Auto-curator-considered gate** (same as code-review.md::present_findings):

```bash
CURATOR_GATE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-auto-curator-considered)
if echo "$CURATOR_GATE" | jq -e '.ok == false' >/dev/null 2>&1; then
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=present_findings status=BLOCKED verdict=FAILED
  echo "BLOCKED: $(echo "$CURATOR_GATE" | jq -r '.reason')"
  exit 0
fi
```

**Verifier-ran enforcement gate** (same as code-review.md::present_findings):

```bash
VERIF_GATE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-verifier-ran)
if echo "$VERIF_GATE" | jq -e '.ok == false' >/dev/null 2>&1; then
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=verify status=BLOCKED verdict=FAILED
  echo "BLOCKED: $(echo "$VERIF_GATE" | jq -r '.reason')"
  exit 0
fi
```

**Lane knowledge-candidate aggregation** — parallel-flow specific. Lane code-reviewers append `#KNOWLEDGE-CANDIDATE:` lines to their lane output files (`review-lane-*.md`), not directly to scratchpad. Without this step, the knowledge-candidates-tagged gate below would false-block parallel reviews even when lanes diligently surfaced candidates. Scans lane outputs + the consolidated review.md, dedupes by content, appends to scratchpad with provenance comments per source.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state aggregate-knowledge-candidates
```

**Knowledge-candidates-tagged gate** (same as code-review.md::present_findings — runs AFTER lane aggregation so the parallel-flow tags surface in scratchpad):

```bash
KC_GATE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-knowledge-candidates-tagged)
if echo "$KC_GATE" | jq -e '.ok == false' >/dev/null 2>&1; then
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=present_findings status=BLOCKED verdict=FAILED
  echo "BLOCKED: $(echo "$KC_GATE" | jq -r '.reason')"
  exit 0
fi
```

Read `.devt/state/review.md` and present to the user:

- **Verdict**: APPROVED / APPROVED_WITH_NOTES / NEEDS_WORK
- **Score**: N / 100
- **Summary**: 2-3 sentence overview
- **Findings by severity**: Critical, Important, Minor (with file and line references)
- **Score breakdown**: by category (architecture, security, performance, etc.)
- **Graphify activity** (one line; the telemetry surface below populates it)

Additionally, surface the `## Lane Provenance` section verbatim so the user sees which communities contributed which findings.

**Graphify activity surface**:

```bash
WID=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state read | jq -r '.workflow_id // empty')
if [ -n "$WID" ]; then
  # Trace records UNPREFIXED tool names (`mcp__devt-graphify__*`) regardless
  # of how the orchestrator invokes (orchestrator uses prefixed
  # `mcp__plugin_devt_devt-graphify__*` per Claude Code plugin-namespacing,
  # but the recorded tool field in _mcp-trace.jsonl is the unprefixed form).
  # mcp-stats queries must use the unprefixed form to match trace records.
  # Workflow PROSE references for graphify tools stay prefixed.
  GRAPHIFY_SUMMARY=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" mcp-stats --workflow-id="$WID" --tool='mcp__devt-graphify__*' --by=calls 2>/dev/null || echo "")
  GRAPHIFY_UPSTREAM=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" mcp-stats --workflow-id="$WID" --tool='mcp__graphify__*' --by=calls 2>/dev/null || echo "")
  PLAN_TIER=$(jq -r '.tier // "unknown"' .devt/state/graphify-impact-plan.json 2>/dev/null || echo "unknown")
  if [ -f .devt/state/graphify-skip-reason.txt ]; then
    SKIP_REASON=$(cat .devt/state/graphify-skip-reason.txt)
    echo "Graphify activity: SKIPPED (plan=$PLAN_TIER, reason: $SKIP_REASON)"
  else
    echo "Graphify activity: tier=$PLAN_TIER"
    echo "$GRAPHIFY_SUMMARY"
    echo "$GRAPHIFY_UPSTREAM"
  fi
fi
```

Surface the output verbatim in the user report under "Graphify activity". When the trace file is missing or `workflow_id` is unset, emit `Graphify activity: telemetry unavailable` and continue.

This is a READ-ONLY workflow. Do NOT offer to fix findings.

**Memory-candidate footer** (B-III.1.c — KEEP IN SYNC across code-review.md, code-review-parallel.md, quick-implement.md::finalize, dev-workflow.md::finalize).

```bash
CC_STATUS=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" memory candidates-status 2>/dev/null || echo '{"ready_to_surface":false}')
if echo "$CC_STATUS" | jq -e '.ready_to_surface == true' >/dev/null 2>&1; then
  CC_COUNT=$(echo "$CC_STATUS" | jq -r '.count')
  echo ""
  echo "💭 ${CC_COUNT} memory candidates pending in .devt/memory/_suggestions.md — run /devt:memory promote to triage."
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" memory candidates-touch-surface >/dev/null 2>&1 || true
fi
```

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=complete status=DONE active=false
```

</step>
