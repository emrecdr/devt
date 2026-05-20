# Code Review Workflow

Standalone code review: READ-ONLY analysis with findings and recommendations. No edits or writes to project code.

---

<prerequisites>
- `.devt/config.json` exists in project root (run `/init` first if not)
- `.devt/rules/` directory exists with project conventions
- `${CLAUDE_PLUGIN_ROOT}` is set (devt plugin is loaded)
- `node` is available on PATH
</prerequisites>

<available_agent_types>
The following agent type is used in this workflow:

- `devt:code-reviewer` — code review specialist, READ-ONLY (Read, Bash, Glob, Grep)

Not used in this workflow:

- `devt:programmer` — implementation specialist
- `devt:tester` — testing specialist
- `devt:architect` — structural review specialist
- `devt:docs-writer` — documentation specialist
- `devt:retro` — lesson extraction specialist
- `devt:curator` — playbook quality maintenance specialist
  </available_agent_types>

<agent_skill_injection>
Before dispatching the code-reviewer agent, check `.devt/config.json` for an `agent_skills` configuration block:

```json
{
  "agent_skills": {
    "code-reviewer": ["code-review-guide"]
  }
}
```

If `agent_skills.code-reviewer` exists, inject the skill references into the agent's prompt context:

```
<agent_skills>
  Load and follow these skill protocols before starting work:
  - ${CLAUDE_PLUGIN_ROOT}/skills/<skill_name>/  (for each skill listed)
</agent_skills>
```

If not configured, omit the block.
</agent_skill_injection>

---

## Steps

<step name="context_init" gate="compound init succeeds">

Initialize the workflow (read-only — do NOT reset .devt/state/ as it may contain artifacts from a prior workflow that this review depends on):

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" init review
```

Load project context:

- Read `.devt/rules/coding-standards.md`
- Read `.devt/rules/architecture.md`
- Read `.devt/rules/quality-gates.md`
- Read `CLAUDE.md` if it exists

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update active=true workflow_type=code_review phase=context_init status=DONE stopped_at=null stopped_phase=null verdict=null repair=null verify_iteration=0 resume_context=null "task=${REVIEW_SCOPE}"
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" preflight generate "${REVIEW_SCOPE}"
```

The second call auto-fires the **Topic Pre-Flight Brief** for the review scope. The reviewer reads `.devt/state/preflight-brief.md` so the review checklist gains "alignment with governing ADRs/Concepts" and "no proposed changes that match a REJ tombstone" — high-leverage code-review items that are otherwise easy to miss. Skip silently on failure.

**Compute the memory signal once and cache it for downstream dispatches.** The same `memory query --signal=3` aggregate keyed on the review scope is consumed by both the code-reviewer and verifier dispatches — compute once here, cache in `workflow.yaml`, read back in each orchestrator-prep step below:

```bash
MEMORY_SIGNAL=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" memory query "${REVIEW_SCOPE}" --signal=3 --json-compact 2>/dev/null || echo '{}')
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update memory_signal_json="${MEMORY_SIGNAL}"
```

**Cache the scope hint** for `<scope_hint>` injection. `preflight generate` writes `preflight-brief.json` alongside the markdown; its `suggested_reading` field is the deduped union of governing docs' `affects_paths` plus blast-radius `direct_dependents`, capped at 8:

```bash
SCOPE_HINT=$(jq -c '.suggested_reading // []' .devt/state/preflight-brief.json 2>/dev/null || echo '[]')
SCOPE_TRUST=$(jq -c '{trust: (.graph_stats.trust // "empty"), lag_commits: .staleness.lag_commits, fresh: (.staleness.fresh // false)}' .devt/state/preflight-brief.json 2>/dev/null || echo '{}')
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update scope_hint_json="${SCOPE_HINT}" scope_trust_json="${SCOPE_TRUST}"
```

**Staleness gate** — If `preflight-brief.json::staleness.lag_commits > graphify.stale_threshold` (default 30; `null` disables), prompt the user via AskUserQuestion BEFORE the impact-map fetch and any agent dispatch: question "Graphify graph is {lag_commits} commits behind HEAD; review may miss recent caller-set changes. Refresh now?" Options: **Refresh (recommended)** — pause for `graphify update .`, re-run preflight, continue; **Proceed with stale graph** — continue dispatch with `scope_trust.fresh=false`; **Cancel** — STOP with BLOCKED. In autonomous mode, force `scope_trust.trust="sparse"` and proceed. Skip when graphify disabled or lag_commits is null.

**Evict any stale Graphify artifacts before regeneration.** A prior session's `graph-impact.md` or `graphify-skip-reason.txt` would otherwise look current and silently mask whether the orchestrator actually ran the plan this session. Targeted — never touches `impl-summary.md`, `test-summary.md`, etc. that the review may legitimately consume from a prior workflow phase. The CLI is the single source of truth for the eviction set (also used by `dev-workflow`, `quick-implement`, `debug`, `research-task`):

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state evict-graphify
```

**Compute the Graphify impact-map plan.** This bash step decides which tier the orchestrator MUST execute next. It writes `.devt/state/graphify-impact-plan.json` carrying `{tier, tool, args, skip_reason?}`. The orchestrator then has ONE imperative instruction below — no "run the first matching" prose to skip past.

```bash
GIT_PROVIDER=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" config get git.provider 2>/dev/null | jq -r '.value // ""')
PR_NUM=$(echo "${REVIEW_SCOPE}" | grep -oE '(PR|pull request) ?#?[0-9]+' | grep -oE '[0-9]+' | head -1)
GRAPHIFY_STATE=$(jq -r '.graph_stats.state // "not_ready"' .devt/state/preflight-brief.json 2>/dev/null || echo "not_ready")
GRAPHIFY_TRUST=$(jq -r '.graph_stats.trust // "empty"' .devt/state/preflight-brief.json 2>/dev/null || echo "empty")
TOPIC_SYMBOLS=$(jq -c '.topic.symbols // []' .devt/state/preflight-brief.json 2>/dev/null || echo '[]')
TOPIC_SYMBOLS_COUNT=$(echo "$TOPIC_SYMBOLS" | jq 'length')
SCOPE_FILE_COUNT=$(wc -l < .devt/state/review-scope.md 2>/dev/null | tr -d ' ' || echo 0)
IMPACT_THRESHOLD=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" config get graphify.impact_threshold 2>/dev/null | jq -r '.value // 10')

# Decision tree — explicit, no implicit fallbacks. The recommended tier is the
# first one whose preconditions all hold. Bitbucket projects skip PR-scoped
# because the upstream mcp__graphify__get_pr_impact tool is GitHub-only and
# returns "PR not found on GitHub" — the workflow would waste a call.
if [ "$GRAPHIFY_STATE" != "ready" ]; then
  TIER="skip"; SKIP_REASON="graphify state=$GRAPHIFY_STATE"; TOOL=""; ARGS_JSON='{}'
elif [ -n "$PR_NUM" ] && [ "$GIT_PROVIDER" = "github" ]; then
  TIER="pr_scoped"; SKIP_REASON=""; TOOL="mcp__graphify__get_pr_impact"; ARGS_JSON="$(jq -nc --arg n "$PR_NUM" '{pr_number: ($n|tonumber)}')"
elif [ "$SCOPE_FILE_COUNT" -ge "$IMPACT_THRESHOLD" ] && [ "$GRAPHIFY_TRUST" = "dense" ]; then
  TIER="bulk_scoped"; SKIP_REASON=""; TOOL="mcp__devt-graphify__query_graph"; ARGS_JSON="$(jq -nc --arg t "$REVIEW_SCOPE" '{text: $t, limit: 20}')"
elif [ "$TOPIC_SYMBOLS_COUNT" -gt 0 ]; then
  TIER="symbol_anchored"; SKIP_REASON=""; TOOL="mcp__devt-graphify__blast_radius"; ARGS_JSON="$(jq -nc --argjson s "$TOPIC_SYMBOLS" '{symbols: $s}')"
else
  TIER="skip"; SKIP_REASON="no PR (or non-GitHub), scope below threshold, no topic symbols"; TOOL=""; ARGS_JSON='{}'
fi

jq -nc --arg tier "$TIER" --arg tool "$TOOL" --arg skip_reason "$SKIP_REASON" --arg provider "$GIT_PROVIDER" --argjson args "$ARGS_JSON" \
  '{tier: $tier, tool: $tool, args: $args, skip_reason: $skip_reason, git_provider: $provider}' \
  > .devt/state/graphify-impact-plan.json
echo "graphify_impact_plan: tier=$TIER tool=$TOOL provider=$GIT_PROVIDER"
```

**EXECUTE THE PLAN.** Read `.devt/state/graphify-impact-plan.json`. This is not optional and not a "consider running it" — the next step gates on the output existing:

- If `tier == "skip"`: write `.devt/state/graphify-skip-reason.txt` containing the `skip_reason` field verbatim. Do NOT call any MCP tool. The reviewer falls back to `<scope_hint>` plus raw file list and graph-impact analysis is correctly absent.
- If `tier == "pr_scoped"`: call `mcp__graphify__get_pr_impact(args)` using the args from the plan. **For Bitbucket projects this tier never fires** — the bash step routed past it. If the call errors (e.g. PR not found because the user-installed graphify MCP cannot reach the repo), fall back: write `graphify-skip-reason.txt` with the error and continue. Otherwise write the response verbatim to `.devt/state/graph-impact.md`.
- If `tier == "bulk_scoped"`: call `mcp__devt-graphify__query_graph(args)`. From the response's top-5 nodes (highest degree), call `mcp__devt-graphify__get_neighbors({symbol: <label>, direction: "in", depth: 2})` for each. Concatenate into `graph-impact.md` with one `## <symbol>` heading per block.
- If `tier == "symbol_anchored"`: call `mcp__devt-graphify__blast_radius(args)`. Write the response verbatim to `graph-impact.md`.

After this step, **EXACTLY ONE** of `graph-impact.md` or `graphify-skip-reason.txt` MUST exist. Enforced by a hard process gate — not prose:

```bash
ASSERT=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-graphify-decision)
if [ "$(echo "$ASSERT" | jq -r '.ok')" != "true" ]; then
  echo "BLOCKED: graphify decision artifact missing — $(echo "$ASSERT" | jq -r '.reason')"
  exit 1
fi
```

The assert auto-passes when graphify is disabled or the graph is missing (`graphify_state != "ready"`) — the gate is about orchestrator obedience to the workflow contract, not about graphify being installed.

**Gate**: If compound init fails, STOP with BLOCKED. If `state assert-graphify-decision` returns `ok:false`, STOP with BLOCKED — the orchestrator skipped the EXECUTE THE PLAN step above.
</step>

<step name="identify_scope" gate="file list is determined">

Determine which files to review. Use ONE of these strategies (in priority order):

1. **User-specified files**: If the user provided specific file paths or patterns, use those.
2. **Git diff**: If no files were specified, detect changed files:
   ```bash
   git diff --name-only HEAD~1 2>/dev/null || git diff --name-only --staged 2>/dev/null || echo "NO_DIFF"
   ```
3. **Impl-summary**: If `.devt/state/impl-summary.md` exists from a prior workflow, extract the file list from it.
4. **User prompt**: If none of the above yields results, ask the user which files to review.

Write the file list to `.devt/state/review-scope.md`:

```markdown
# Review Scope

## Files

- path/to/file1
- path/to/file2

## Source

<how the file list was determined: user-specified / git-diff / impl-summary / user-prompt>
```

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=identify_scope status=DONE
```

</step>

<step name="review" gate="review.md is written to .devt/state/">

**Orchestrator-prep — read cached memory signal**. Cached at context_init; re-read here so the reviewer can spot REJ-tombstone matches and ADR violations without per-doc round trips:

```bash
STATE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state read)
MEMORY_SIGNAL=$(echo "$STATE" | jq -r '.memory_signal_json // "{}"')
SCOPE_HINT=$(echo "$STATE" | jq -r '.scope_hint_json // "[]"')
SCOPE_TRUST=$(echo "$STATE" | jq -r '.scope_trust_json // "{}"')
```

Substitute into the `<memory_signal>` block below.

Dispatch the code-reviewer agent with the identified file scope:

```
Task(subagent_type="devt:code-reviewer", model="{models.code-reviewer}", prompt="
  <context>
    <!-- KEEP IN SYNC: this <governing_rules> block is duplicated across the
         researcher, code-reviewer, and verifier dispatch templates in
         workflows/{dev-workflow,quick-implement,code-review,research-task}.md.
         When one changes, update the others. governing_rules comes from the
         init payload; omit this block entirely when content is empty (agent
         falls back to on-disk Reads of CLAUDE.md + .devt/rules/*.md). -->
    <governing_rules rules_hash=\"{governing_rules.rules_hash}\">
      <claude_md>{governing_rules.content[\"CLAUDE.md\"]}</claude_md>
      <coding_standards>{governing_rules.content[\".devt/rules/coding-standards.md\"]}</coding_standards>
      <architecture>{governing_rules.content[\".devt/rules/architecture.md\"]}</architecture>
      <quality_gates>{governing_rules.content[\".devt/rules/quality-gates.md\"]}</quality_gates>
      <review_checklist>{governing_rules.content[\".devt/rules/review-checklist.md\"]}</review_checklist>
    </governing_rules>
    <!-- KEEP IN SYNC: the <memory_signal> block + its orchestrator-prep step
         are duplicated across programmer + code-reviewer + verifier dispatches
         in dev-workflow.md, code-review.md, and quick-implement.md. When the
         CLI shape or block position changes, update all five. -->
    <memory_signal>{memory_signal_json}</memory_signal>
    <scope_hint>{scope_hint_json}</scope_hint>
    <scope_trust>{scope_trust_json}</scope_trust>
    <review_scope>Read .devt/state/review-scope.md</review_scope>
    <impl_summary>Read .devt/state/impl-summary.md (if exists)</impl_summary>
    <test_summary>Read .devt/state/test-summary.md (if exists)</test_summary>
    <decisions>Read .devt/state/decisions.md (if exists — from /devt:clarify)</decisions>
    <learning_context>{learning_context — relevant review/quality lessons from .devt/memory/lessons/ via Pre-Flight Brief, if any}</learning_context>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
  </context>
  <task>
    Review the following files for quality, correctness, and standards compliance.
    Review ALL code in the listed files — do not filter by origin or label findings as pre-existing.
    Every valid finding must be reported with file, line, severity, and rule reference.

    Graph-impact map: the orchestrator wrote `.devt/state/graph-impact.md` (or `graphify-skip-reason.txt`)
    during context_init using upstream Graphify MCP. You consume that file READ-ONLY — your tool surface
    does not include `mcp__*graphify*`, so use the data already present rather than issuing graph queries
    yourself. When the impact map lists affected_communities, blast radius, or caller sets for symbols
    touched by your findings, cross-reference them as you write each finding's remediation. Use Grep/Read
    to validate specific code lines that the map points to. When `graphify-skip-reason.txt` exists, no
    graph data is available — proceed with Grep+Read review normally.
  </task>
  Write review to .devt/state/review.md
")
```

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=review status=DONE
```

</step>

<step name="verify" gate="verification.json is written or step is skipped">

_Skip this step if `config.workflow.verification` is `false`._
_Skip this step if `verify` is listed in `skipped_phases` from workflow state._

Grader-driven thoroughness check. The verifier reads `references/rubrics/code_review.v1.md` and spot-checks the review for scope coverage, finding specificity, severity calibration, remediation concreteness, and ADR Compliance section presence. The verifier does NOT re-do the code review — it grades the review's quality and re-dispatches the code-reviewer with structured `revisions[]` when gaps are found.

**Artifact pre-gate**: confirm both `.devt/state/review.md` and `.devt/state/review.json` exist. If either is missing, **STOP with BLOCKED** — verification cannot run without the upstream artifact. The sidecar is the routing source of truth; the markdown is the human-readable view.

**Orchestrator-prep — read cached memory signal**. Cached at context_init; re-read here so the verifier doesn't burn 3–4 per-doc `memory query` round trips on its initial scan:

```bash
STATE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state read)
MEMORY_SIGNAL=$(echo "$STATE" | jq -r '.memory_signal_json // "{}"')
SCOPE_HINT=$(echo "$STATE" | jq -r '.scope_hint_json // "[]"')
SCOPE_TRUST=$(echo "$STATE" | jq -r '.scope_trust_json // "{}"')
```

Substitute the JSON output into the `<memory_signal>` block in the dispatch prompt below. If `.devt/memory/` is empty or the query fails, the fallback `{}` keeps the block well-formed and the agent falls back to fresh queries.

Dispatch the verifier:

```
Task(subagent_type="devt:verifier", model="{models.verifier}", prompt="
  <context>
    <workflow_type>code_review</workflow_type>
    <rubric_path>references/rubrics/{rubrics.code_review}</rubric_path>
    <!-- Inline rubric body from init payload — verifier prefers this over the
         on-disk Read at <rubric_path> when present. Falls back to path when
         omitted (oversized rubric → init returns null inline_rubrics). -->
    <rubric_content>{inline_rubrics.code_review}</rubric_content>
    <original_task>{review_scope_description}</original_task>
    <!-- KEEP IN SYNC: the <memory_signal> block + its orchestrator-prep step
         are duplicated in workflows/dev-workflow.md verifier dispatch. When the
         CLI shape or block position changes, update both. -->
    <memory_signal>{memory_signal_json}</memory_signal>
    <scope_hint>{scope_hint_json}</scope_hint>
    <scope_trust>{scope_trust_json}</scope_trust>
    <!-- KEEP IN SYNC: this <governing_rules> block is duplicated across the
         researcher, code-reviewer, and verifier dispatch templates. When one
         changes, update the others. -->
    <governing_rules rules_hash=\"{governing_rules.rules_hash}\">
      <claude_md>{governing_rules.content[\"CLAUDE.md\"]}</claude_md>
      <quality_gates>{governing_rules.content[\".devt/rules/quality-gates.md\"]}</quality_gates>
      <review_checklist>{governing_rules.content[\".devt/rules/review-checklist.md\"]}</review_checklist>
    </governing_rules>
    <files_to_read>.devt/state/review.md, .devt/state/review-scope.md</files_to_read>
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
  - **`VITER < MAX_ITER` → RETRY**: re-dispatch the **code-reviewer** (Step `review`) with each `revisions[].gap` (axis + AC-letter id + evidence) verbatim as `<reviewer_feedback>` in the prompt. Do NOT have the reviewer re-parse the markdown; the structured list is the contract.
    ```bash
    node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=verify verify_iteration=$((VITER+1)) verdict=GAPS_FOUND repair=RETRY
    ```
  - **`VITER >= MAX_ITER` → PRUNE**: stop iterating. Write remaining `revisions[]` to `.devt/state/scratchpad.md` under `## Deferred Review Verification Gaps`. Proceed to `present_findings` with `status=DONE_WITH_CONCERNS` and surface the deferred gaps in the user report.
    ```bash
    node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=verify status=DONE_WITH_CONCERNS verdict=GAPS_FOUND repair=PRUNE
    ```
- **`verdict=failed`** (status=FAILED) — STOP with BLOCKED. Surface the verifier's failure reason (missing review.md, missing review-scope.md, REJ tombstone match, or 3+ axes failing simultaneously) to the user. No retry — this is a structural problem requiring human attention.
  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=verify status=BLOCKED verdict=FAILED
  ```

</step>

<step name="present_findings" gate="findings are reported to the user">

Read `.devt/state/review.md` and present to the user:

- **Verdict**: APPROVED / APPROVED_WITH_NOTES / NEEDS_WORK
- **Score**: N / 100
- **Summary**: 2-3 sentence overview
- **Findings by severity**: Critical, Important, Minor (with file and line references)
- **Score breakdown**: by category (architecture, security, performance, etc.)
- **Graphify activity** (one line; the telemetry surface below populates it)

**Graphify activity surface** — surface what graphify tools were actually invoked during this workflow. Without this line, the user has no way to verify the integration was used vs. silently fell back to grep. Reads `.devt/memory/_mcp-trace.jsonl` filtered by the current `workflow_id`:

```bash
WID=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state read | jq -r '.workflow_id // empty')
if [ -n "$WID" ]; then
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

Surface the output verbatim in the user report under "Graphify activity". When the trace file is missing or `workflow_id` is unset (legacy workflow.yaml predating auto-stamp), emit `Graphify activity: telemetry unavailable` and continue — best-effort.

This is a READ-ONLY workflow. Do NOT offer to fix findings. If the user wants fixes applied, they should run `/implement` or `/workflow` with the review findings as input.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=complete status=DONE active=false
```

</step>

---

<deviation_rules>

1. **Auto-fix: bugs** — Not applicable. This is a READ-ONLY workflow.
2. **Auto-fix: lint** — Not applicable. This is a READ-ONLY workflow.
3. **Auto-fix: deps** — Not applicable. This is a READ-ONLY workflow.
4. **STOP: architecture** — If no files can be identified for review (no git diff, no user input, no impl-summary), STOP with NEEDS_CONTEXT and ask the user to specify files.
   </deviation_rules>

<success_criteria>

- Review scope is determined (at least one file to review)
- Code review is complete (review.md is written with verdict and findings)
- Findings are presented to the user with severity, location, and rule references
- No code was modified (READ-ONLY)
- Final status: **DONE**
  </success_criteria>

## Memory layer integration

Code review now produces an "ADR Compliance" section in `.devt/state/review.md` (Critical
severity for violations). For each diff hunk:
1. `node bin/devt-tools.cjs memory affects <changed-file>` enumerates governing ADRs/CONs/FLOWs
2. Verify diff respects each (treat violations as Critical)
3. `node bin/devt-tools.cjs memory rejected-keywords` — flag any diff text matching a REJ
4. When `.devt/state/graph-impact.md` exists, read it — it carries the impact map from one of the three trigger tiers (PR-scoped via upstream `mcp__graphify__get_pr_impact`, bulk-scoped via vendored `mcp__devt-graphify__query_graph`+`get_neighbors`, or symbol-anchored via `mcp__devt-graphify__blast_radius`). The orchestrator wrote this file during context_init using its MCP tool surface — the code-reviewer agent consumes it READ-ONLY. Communities/dependents listed there get priority over unrelated files in the scope list, and finding severity is weighted by structural blast radius rather than file count
ADRs are constitutional — same severity as security findings.
