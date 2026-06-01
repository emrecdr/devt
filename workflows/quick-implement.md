# Quick Implementation Workflow

Fast-path development cycle: scan, implement, test, review. Skips documentation, retrospective, and curation for speed.

---

<prerequisites>
- `.devt/config.json` exists in project root (run `/init` first if not)
- `.devt/rules/` directory exists with project conventions
- `${CLAUDE_PLUGIN_ROOT}` is set (devt plugin is loaded)
- `node` is available on PATH
- The user has provided a task description as the command argument
</prerequisites>

<available_agent_types>
The following agent types are used in this workflow:

- `devt:programmer` — implementation specialist (Read, Write, Edit, Bash, Glob, Grep)
- `devt:tester` — testing specialist (Read, Write, Edit, Bash, Glob, Grep)
- `devt:code-reviewer` — code review specialist, READ-ONLY (Read, Bash, Glob, Grep)

Not used in this workflow:

- `devt:architect` — structural review specialist
- `devt:docs-writer` — documentation specialist
- `devt:retro` — lesson extraction specialist
- `devt:curator` — playbook quality maintenance specialist
  </available_agent_types>

<agent_skill_injection>
Before dispatching any agent, check `.devt/config.json` for an `agent_skills` configuration block:

```json
{
  "agent_skills": {
    "programmer": ["api-docs-fetcher", "scratchpad"],
    "tester": ["scratchpad"],
    "code-reviewer": ["code-review-guide"]
  }
}
```

If `agent_skills.<agent_type>` exists, inject the skill references into the agent's prompt context:

```
<agent_skills>
  Load and follow these skill protocols before starting work:
  - ${CLAUDE_PLUGIN_ROOT}/skills/<skill_name>/  (for each skill listed)
</agent_skills>
```

Read `resolved_skills.<agent_type>` from the compound `init` output (`init.cjs::resolveSkills` — merges `.devt/config.json::agent_skills` with `${CLAUDE_PLUGIN_ROOT}/skill-index.yaml` defaults, config wins). Inject the list as the `<agent_skills>` block in the agent's task prompt.
</agent_skill_injection>

---

## Steps

<step name="context_init" gate="compound init succeeds and .devt/rules/ is readable">

Initialize the workflow:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" init workflow
```

Load project context:

- Read `.devt/rules/coding-standards.md`
- Read `.devt/rules/architecture.md`
- Read `.devt/rules/quality-gates.md`
- Read `.devt/rules/testing-patterns.md`
- Read `CLAUDE.md` if it exists
- Read `.devt/state/spec.md` if it exists (from `/devt:specify`)
  - If spec exists: use it as the primary requirements source

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update active=true workflow_type=quick_implement phase=context_init tier=SIMPLE status=DONE stopped_at=null stopped_phase=null verdict=null repair=null verify_iteration=0 resume_context=null "task=${TASK_DESCRIPTION}"
```

**Evict stale Graphify artifacts** before regenerating preflight + impact data. Prevents cross-workflow contamination (a prior `/devt:review` or sibling workflow's `graph-impact.md` would otherwise persist and mislead this session's scan):

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state evict-graphify
```

**Auto-fire Pre-Flight Brief**:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" preflight generate "${TASK_DESCRIPTION}"
```

Produces `.devt/state/preflight-brief.md`. The programmer agent reads it before edits. Skip silently if the call fails.

**Compute the memory signal once and cache it for downstream dispatches.** Same aggregate is consumed by the programmer and code-reviewer dispatches — compute once here, cache in `workflow.yaml`, read back in each orchestrator-prep step below:

```bash
MEMORY_SIGNAL=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" memory query "${TASK_DESCRIPTION}" --signal=3 --json-compact 2>/dev/null || echo '{}')
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update memory_signal_json="${MEMORY_SIGNAL}"
```

**Cache the scope hint** for `<scope_hint>` injection. `preflight generate` writes `preflight-brief.json` alongside the markdown; its `suggested_reading` field is the deduped union of governing docs' `affects_paths` plus blast-radius `direct_dependents`, capped at 8:

```bash
# Single CLI call replaces the prior 4-jq + conditional + state-update chain.
# Reads preflight-brief.json, computes scope_hint + scope_trust, applies the
# mechanical staleness override (forces trust='sparse' + writes
# staleness-suppressed.txt when state=ready AND lag exceeds graphify.stale_threshold
# or is null), and persists both JSON blobs to workflow.yaml.
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" preflight scope-cache
```

**Staleness gate** — If `preflight-brief.json::staleness.lag_commits > graphify.stale_threshold` (default 30) OR (`graph_stats.state` is `ready` AND `staleness.lag_commits` is `null`), prompt the user via AskUserQuestion BEFORE the programmer dispatch: "Graphify graph is {lag_commits ?? 'unknown'} commits behind HEAD; symbol-to-file mappings may be stale. Refresh now?" Options: **Refresh (recommended)** — pause for `graphify update .`, re-run preflight, continue; **Proceed with stale graph** — continue with `scope_trust.fresh=false`; **Cancel** — STOP with BLOCKED. In autonomous mode, force `scope_trust.trust="sparse"` and proceed. Skip only when graphify is disabled — a null `lag_commits` while `state=ready` (e.g., unreachable SHA, shallow clone) now triggers the prompt instead of silently disabling the gate.

**Graphify scan-prep gate** — When the task is non-trivial AND the graph is dense AND blast radius is substantial, instruct the orchestrator to write a fresh `.devt/state/graph-impact.md` via two MCP calls. Field-validated threshold (greenfield-api forensic): `direct_dependents_count >= 10 AND graph_stats.trust == "dense"`. Below the threshold (or graphify disabled): skip; agents fall back to grep + scope_hint. The decision tree is bash; the MCP calls are the orchestrator's responsibility:

```bash
DEPENDENTS=$(jq -r '.blast.direct_dependents_count // 0' .devt/state/preflight-brief.json 2>/dev/null || echo 0)
TRUST=$(jq -r '.graph_stats.trust // "empty"' .devt/state/preflight-brief.json 2>/dev/null || echo "empty")
SYMBOLS_JSON=$(jq -c '.topic.symbols // []' .devt/state/preflight-brief.json 2>/dev/null || echo '[]')
SYMBOLS_COUNT=$(echo "$SYMBOLS_JSON" | jq 'length')
# C-III.1: adaptive threshold scales with graph size — small graphs need a
# lower bar to surface useful blast maps. max(5, log10(node_count) * 2):
# 100 nodes → 5, 5K → 8, 45K → 10, 100K+ → 10.
ADAPTIVE_THRESHOLD=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" graphify adaptive-threshold 2>/dev/null | jq -r '.threshold // 10' || echo 10)
if [ "$TRUST" = "dense" ] && [ "$DEPENDENTS" -ge "$ADAPTIVE_THRESHOLD" ] && [ "$SYMBOLS_COUNT" -gt 0 ]; then
  CENTRAL_SYMBOL=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" preflight pick-central-symbol "$SYMBOLS_JSON" "${TASK_DESCRIPTION:-}" 2>/dev/null | head -1)
  [ -z "$CENTRAL_SYMBOL" ] && CENTRAL_SYMBOL=$(echo "$SYMBOLS_JSON" | jq -r '.[0]')
  echo "graphify_scan_prep: ACTIVE — central=$CENTRAL_SYMBOL dependents=$DEPENDENTS trust=$TRUST threshold=$ADAPTIVE_THRESHOLD"
elif [ "$TRUST" = "dense" ] && [ "$SYMBOLS_COUNT" = "0" ]; then
  echo "graphify_scan_prep: RECOVERY — symbols=0 trust=dense; orchestrator must call query_graph(task_text) to resolve synthetic symbols, then proceed with get_neighbors + blast_radius on the top result"
else
  REASON="dependents=$DEPENDENTS trust=$TRUST symbols=$SYMBOLS_COUNT (need dense+≥${ADAPTIVE_THRESHOLD}+symbols)"
  echo "graphify_scan_prep: SKIP — $REASON"
  printf '%s\n' "$REASON" > .devt/state/graphify-skip-reason.txt
fi
```

When the bash echo prints `ACTIVE`, the orchestrator MUST execute these two MCP calls and concatenate the output into `.devt/state/graph-impact.md`:

1. **`mcp__plugin_devt_devt-graphify__blast_radius({symbols: ["<CENTRAL_SYMBOL>"]})`** — first call, returns the impact map with `direct_dependents` array.
2. **Drill-down on top-3 direct dependents** (F16 — multi-tier follow-up). Parse `direct_dependents` from blast_radius response, take top-3 by impact_size, and for each call `mcp__plugin_devt_devt-graphify__get_neighbors({symbol: "<DEPENDENT_NAME>", direction: "in", depth: 2})`. Drills DOWN the impact tree so the programmer/code-reviewer sees which callers each high-risk dependent has.

Format `graph-impact.md` with sections `# Graph Impact — <task>` / `## Blast radius — <CENTRAL_SYMBOL>` / `## Drill-down: <dep1> [call: <correlation_id>]` / `## Drill-down: <dep2> [call: <correlation_id>]` / `## Drill-down: <dep3> [call: <correlation_id>]`. The `correlation_id` is the `_meta.correlation_id` field returned by each `get_neighbors` MCP response (8-char hex); omit the `[call: ...]` suffix when the field is absent. Sub-agents will Read this file during their scan + implement phases. When the bash printed `SKIP`, `graphify-skip-reason.txt` was written above as the explicit decision artifact and no MCP call is made — downstream agents fall back to grep+scope_hint.

**When the bash echo prints `RECOVERY`** — topic extraction returned 0 symbols on a dense graph (the F12 snake_case fallback also missed). Orchestrator MUST first call `mcp__plugin_devt_devt-graphify__query_graph({text: "${TASK_DESCRIPTION}", limit: 5})` to resolve synthetic symbols against the graph, then proceed with `get_neighbors` + `blast_radius` using the top result's label as `CENTRAL_SYMBOL`. Write `graph-impact.md` with an additional `## Fuzzy symbol resolution` section listing the query and top results.

**Decision artifact assertion** — hard-fail if the orchestrator skipped writing either artifact:

```bash
PFRESH=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-preflight-fresh)
if [ "$(echo "$PFRESH" | jq -r '.ok')" != "true" ]; then
  echo "BLOCKED: preflight-brief is stale — $(echo "$PFRESH" | jq -r '.reason')"
  exit 1
fi
ASSERT=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-graphify-decision)
if [ "$(echo "$ASSERT" | jq -r '.ok')" != "true" ]; then
  echo "BLOCKED: graphify decision artifact missing — $(echo "$ASSERT" | jq -r '.reason')"
  exit 1
fi
```

The assert auto-passes when graphify is disabled or the graph is missing (`graphify_state != "ready"`).

**Gate**: If compound init fails, STOP with BLOCKED. If `state assert-graphify-decision` returns `ok:false`, STOP with BLOCKED.
</step>

<step name="scan" gate="scan-results.md is written to .devt/state/">

Perform a brief codebase scan focused on the task:

Read `${CLAUDE_PLUGIN_ROOT}/skills/codebase-scan/` for the scan protocol.

Scan for:

- Existing patterns to reuse (prioritize over inventing new ones)
- Interfaces and contracts the implementation must satisfy
- Existing tests to understand testing conventions
- Error types and domain constants

Keep the scan focused — do not map the entire codebase. Find what is needed for THIS task.

Write results to `.devt/state/scan-results.md`.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=scan status=DONE
```

</step>

<step name="implement" gate="impl-summary.json is written with status DONE or DONE_WITH_CONCERNS">

Initialize iteration tracking:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=implement iteration=1
```

**Orchestrator-prep — read cached signals.** Both `memory_signal_json` and `scope_hint_json` computed once at context_init; re-read here so the agent's initial scan can use pre-resolved data instead of per-doc round trips:

```bash
STATE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state read)
MEMORY_SIGNAL=$(echo "$STATE" | jq -r '.memory_signal_json // "{}"')
SCOPE_HINT=$(echo "$STATE" | jq -r '.scope_hint_json // "[]"')
SCOPE_TRUST=$(echo "$STATE" | jq -r '.scope_trust_json // "{}"')
```

**Reuse pre-search** — derive graphify-powered candidates before the programmer writes new code. Best-effort: swallowed on graphify unavailability (0 candidates, gate passes transparently).

```bash
# KEEP IN SYNC: mirrored in dev-workflow.md implement step
TASK_TEXT=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state read | jq -r '.task // ""')
if [ -n "$TASK_TEXT" ]; then
  # Write the attempted-marker BEFORE invoking the CLI. assert-reuse-analyzed
  # uses marker presence to distinguish "ran with 0 candidates" from
  # "orchestrator skipped this block entirely". The result= line preserves
  # CLI failure context for the gate's BLOCK message.
  {
    echo "attempted_at=$(date -u +%FT%TZ)"
    echo "task=${TASK_TEXT}"
  } > .devt/state/reuse-search-attempted.txt
  REUSE_RESULT=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state derive-reuse-candidates "$TASK_TEXT" 2>/dev/null || echo '{"ok":false,"error":"cli_failed"}')
  echo "result=${REUSE_RESULT}" >> .devt/state/reuse-search-attempted.txt
  REUSE_COUNT=$(echo "$REUSE_RESULT" | jq -r '.candidates_total // 0')
  echo "reuse-search: ${REUSE_COUNT} candidates → .devt/state/reuse-candidates.md"
fi
```

Dispatch the programmer agent:

```
<!-- BEGIN dispatch:programmer:quick_implement -->
Task(subagent_type="devt:programmer", model="{models.programmer}", prompt="
  <context>
    <files_to_read>.devt/rules/coding-standards.md, .devt/rules/quality-gates.md, .devt/rules/architecture.md, CLAUDE.md</files_to_read>
<governing_rules rules_hash=\"{governing_rules.rules_hash}\">
      <claude_md>{governing_rules.content[\"CLAUDE.md\"]}</claude_md>
      <coding_standards>{governing_rules.content[\".devt/rules/coding-standards.md\"]}</coding_standards>
      <architecture>{governing_rules.content[\".devt/rules/architecture.md\"]}</architecture>
      <quality_gates>{governing_rules.content[\".devt/rules/quality-gates.md\"]}</quality_gates>
    </governing_rules>
<guardrails_inline>
      <golden_rules>{inline_guardrails["golden-rules.md"]}</golden_rules>
      <engineering_principles>{inline_guardrails["engineering-principles.md"]}</engineering_principles>
      <generative_debt_checklist>{inline_guardrails["generative-debt-checklist.md"]}</generative_debt_checklist>
    </guardrails_inline>
<memory_signal>{memory_signal_json}</memory_signal>
    <scope_hint>{scope_hint_json}</scope_hint>
    <scope_trust>{scope_trust_json}</scope_trust>
<reuse_candidates>Read .devt/state/reuse-candidates.md if present — graphify-derived list of existing functions with similar responsibility. Address each candidate in .devt/state/reuse-analysis.md before writing new code (see programmer.md::reuse_analysis step).</reuse_candidates>
    <scan_results>Read .devt/state/scan-results.md (if exists)</scan_results>
    <spec>Read .devt/state/spec.md (if exists — from /devt:specify)</spec>
    <research>Read .devt/state/research.md (if exists — from /devt:research)</research>
    <decisions>Read .devt/state/decisions.md (if exists)</decisions>
    <review_feedback>Read .devt/state/review.md (if this is a fix iteration)</review_feedback>
    <learning_context>{learning_context from context_init — relevant lessons from .devt/memory/lessons/ via Pre-Flight Brief, if any}</learning_context>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
  </context>
  <task>{task_description}

  **Capture knowledge candidates** (load-bearing — not optional, do this BEFORE writing impl-summary.md): per your `knowledge_candidates` step, if implementation surfaces non-obvious patterns worth promoting (hidden constraint discovered mid-flight, "must always do X" verified empirically, existing invariant that took grep-archaeology to find), append `#KNOWLEDGE-CANDIDATE: [type=decision|concept|flow|rejected] <one-line summary>` lines to `.devt/state/scratchpad.md`. Each tag passes: specificity, durability, non-obviousness, evidence, actionability.
  </task>
  Write summary to .devt/state/impl-summary.md
")
<!-- END dispatch:programmer:quick_implement -->
```

**Gate check**: Read the structured sidecar `.devt/state/impl-summary.json` for routing — the JSON is authoritative for control flow per the sidecar-only contract (the markdown carries no `## Status` header by design):

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state read-sidecar impl-summary.json
```

Route on `status` (`DONE|DONE_WITH_CONCERNS|BLOCKED|NEEDS_CONTEXT`):

- DONE or DONE_WITH_CONCERNS: proceed to test
- BLOCKED: surface the issue to the user and STOP
- NEEDS_CONTEXT: ask the user for clarification, then re-dispatch

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=implement status=$STATUS
```

**Post-implementation graphify refresh** — When `graphify.enabled=true` AND `impl-summary.json::files_modified` is non-empty, branch on `config.graphify.auto_refresh_post_impl` (default `"ask"`):

- **`"ask"` (default)** AND interactive (non-autonomous) mode: emit AskUserQuestion with header "Graphify refresh", question "Code changes landed. The graph is now N commits behind reality. Refresh now?", three options:
    1. **Refresh now (recommended)** — runs `node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" graphify maybe-refresh --force --timeout=60`, surfaces one-line confirmation.
    2. **Skip — I'll refresh manually later** — emits the `💡` tip and continues; user retains control.
    3. **Always auto-refresh for this project** — runs the refresh AND writes `auto_refresh_post_impl: true` into `.devt/config.json` so future workflows in this project skip the prompt.
- **`true`** OR autonomous mode: silently call `node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" graphify maybe-refresh --force --timeout=60` and surface a one-line confirmation (`🔄 Refreshed graphify graph after impl (Xs)` or `⚠️ Graphify refresh skipped: <reason>`).
- **`false`**: surface only the one-line tip — `💡 Code changes made — run `graphify update .` to refresh the project graph; downstream review/debug agents see the new symbols. Skip if you'll re-review immediately.` No prompt, no refresh.

Skip entirely when graphify is disabled or `files_modified` is empty.

</step>

<step name="test" gate="test-summary.json is written with status DONE or DONE_WITH_CONCERNS">

**Reuse-analysis gate** — programmer must have addressed all reuse candidates before tests run.

```bash
# KEEP IN SYNC: mirrored in dev-workflow.md test step
REUSE_GATE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-reuse-analyzed 2>/dev/null || echo '{"ok":true}')
if echo "$REUSE_GATE" | jq -e '.ok == false' >/dev/null 2>&1; then
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=implement status=BLOCKED verdict=FAILED
  echo "BLOCKED: $(echo "$REUSE_GATE" | jq -r '.reason')"
  exit 0
fi
```

Dispatch the tester agent:

```
<!-- BEGIN dispatch:tester:quick_implement -->
Task(subagent_type="devt:tester", model="{models.tester}", prompt="
  <context>
    <files_to_read>.devt/rules/testing-patterns.md, .devt/rules/quality-gates.md, CLAUDE.md</files_to_read>
<governing_rules rules_hash=\"{governing_rules.rules_hash}\">
      <claude_md>{governing_rules.content[\"CLAUDE.md\"]}</claude_md>
      <quality_gates>{governing_rules.content[\".devt/rules/quality-gates.md\"]}</quality_gates>
      <testing_patterns>{governing_rules.content[\".devt/rules/testing-patterns.md\"]}</testing_patterns>
    </governing_rules>
<guardrails_inline>
      <golden_rules>{inline_guardrails[\"golden-rules.md\"]}</golden_rules>
    </guardrails_inline>
    <scope_hint>{scope_hint_json}</scope_hint>
    <scope_trust>{scope_trust_json}</scope_trust>
    <impl_summary_sidecar>Read .devt/state/impl-summary.json — files_changed (authoritative file list), concerns[] (per-file context), next_agent_hints.focus_areas (test priorities), next_agent_hints.skip_areas (don't-test set). Compute coverage_complete by comparing your coverage_files to files_changed; false → re-dispatch with gap as review_feedback.</impl_summary_sidecar>
    <impl_summary>Read .devt/state/impl-summary.md ONLY when a concerns[] entry references prose context not captured by structured fields, OR when next_agent_hints.focus_areas is empty AND files_changed is non-empty (degraded sidecar — fall back to narrative).</impl_summary>
    <spec>Read .devt/state/spec.md (if exists — from /devt:specify)</spec>
    <learning_context>{learning_context from context_init — relevant testing lessons from .devt/memory/lessons/ via Pre-Flight Brief, if any}</learning_context>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
  </context>
  <task>
    Write tests for the implementation described in .devt/state/impl-summary.md.
    Cover happy paths, error paths, and key edge cases.
  </task>
  Write summary to .devt/state/test-summary.md AND structured sidecar to .devt/state/test-summary.json (the JSON is authoritative for routing)
")
<!-- END dispatch:tester:quick_implement -->
```

**Gate check**: Read the structured sidecar `.devt/state/test-summary.json` for routing — the JSON is authoritative for control flow per the sidecar-only contract:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state read-sidecar test-summary.json
```

The sidecar exposes `status` (`DONE|DONE_WITH_CONCERNS|BLOCKED|NEEDS_CONTEXT`), `verdict` (`PASS|FAIL|INDETERMINATE`), and `tests.{added,passed,failed,skipped}_count` fields. Route on `status`:

- DONE or DONE_WITH_CONCERNS: proceed to review
- BLOCKED: surface the issue to the user and STOP
- NEEDS_CONTEXT: ask the user for clarification, then re-dispatch

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=test status=$STATUS
```

</step>

<step name="review" gate="review.md is written with verdict APPROVED or APPROVED_WITH_NOTES">

**Orchestrator-prep — read cached signals.** `memory_signal_json` and `scope_hint_json` cached at context_init; re-read both here:

```bash
STATE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state read)
MEMORY_SIGNAL=$(echo "$STATE" | jq -r '.memory_signal_json // "{}"')
SCOPE_HINT=$(echo "$STATE" | jq -r '.scope_hint_json // "[]"')
SCOPE_TRUST=$(echo "$STATE" | jq -r '.scope_trust_json // "{}"')
```

Dispatch the code-reviewer agent:

```
<!-- BEGIN dispatch:code-reviewer:quick_implement -->
Task(subagent_type="devt:code-reviewer", model="{models.code-reviewer}", prompt="
  <context>
<governing_rules rules_hash=\"{governing_rules.rules_hash}\">
      <claude_md>{governing_rules.content[\"CLAUDE.md\"]}</claude_md>
      <coding_standards>{governing_rules.content[\".devt/rules/coding-standards.md\"]}</coding_standards>
      <architecture>{governing_rules.content[\".devt/rules/architecture.md\"]}</architecture>
      <quality_gates>{governing_rules.content[\".devt/rules/quality-gates.md\"]}</quality_gates>
      <review_checklist>{governing_rules.content[\".devt/rules/review-checklist.md\"]}</review_checklist>
    </governing_rules>
<memory_signal>{memory_signal_json}</memory_signal>
    <scope_hint>{scope_hint_json}</scope_hint>
    <scope_trust>{scope_trust_json}</scope_trust>
    <impl_summary>Read .devt/state/impl-summary.md</impl_summary>
    <test_summary>Read .devt/state/test-summary.md</test_summary>
    <decisions>Read .devt/state/decisions.md (if exists)</decisions>
    <learning_context>{learning_context from context_init — relevant review/quality lessons from .devt/memory/lessons/ via Pre-Flight Brief, if any}</learning_context>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
  </context>
  <task>
    Review the implementation and tests for quality, correctness, and standards compliance.
    Review ALL code in scope — do not filter by origin or label findings as pre-existing.

    **Capture knowledge candidates** (load-bearing — not optional, do this BEFORE writing review.md): per your `knowledge_candidates` step, if this review surfaces non-obvious patterns worth promoting (recurring code smell, undocumented invariant, "we always do X because Y" rule, REJ-tombstone-worthy anti-pattern), append `#KNOWLEDGE-CANDIDATE: [type=decision|concept|flow|rejected] <one-line summary>` lines to `.devt/state/scratchpad.md`. Each tag passes: specificity, durability, non-obviousness, evidence, actionability.
  </task>
  Write review to .devt/state/review.md
")
<!-- END dispatch:code-reviewer:quick_implement -->
```

**Gate check**: Read `.devt/state/review.md` and check verdict:

- **APPROVED** or **APPROVED_WITH_NOTES**: proceed to finalize
- **NEEDS_WORK**:
  - Read the current iteration count
  - If iteration < 2: go back to **implement** with review feedback
    - Increment iteration: `node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=review iteration=$((ITER+1)) verdict=NEEDS_WORK`
    - The programmer agent reads `.devt/state/review.md` as `<review_feedback>`
  - If iteration >= 2: surface all unresolved findings to the user and STOP
    - Report: "Review returned NEEDS_WORK after 2 iterations. Remaining findings require user input."
    - Status: BLOCKED

_Note: Quick-implement limits review iterations to 2 (vs 5 in full workflow which uses RETRY/DECOMPOSE/PRUNE operators) for speed.
Architectural issues still surface to user via BLOCKED status._

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=review status=$STATUS verdict=$VERDICT
```

</step>

<step name="harvest_observations" gate="memory suggest exits 0">

Even though quick-implement skips retro+curator for speed, the harvest itself is unconditional — observations from this workflow are buffered into `.devt/memory/_suggestions.md` for the next dev-workflow's curator to review. This prevents the "fast workflow drops all knowledge candidates on the floor" footgun. Cost: ~10ms (pure filesystem reads).

**Orchestrator pre-step (claude-mem MCP) — DECISION-ARTIFACT REQUIRED.** Exactly ONE of `.devt/state/claude-mem-harvest.md` or `.devt/state/claude-mem-skipped.txt` MUST exist after this step; `state assert-claude-mem-harvest` enforces it.

If `mcp__plugin_claude-mem_mcp-search__search` is registered: (1) call `search` with `query=${task}`, `project=<devt project name>`, `limit=50`; (2) for ⚖️/🔵 rows, call `mcp__plugin_claude-mem_mcp-search__get_observations({ids: [...]})` to fetch bodies (bare `search` returns Title only); (3) write `.devt/state/claude-mem-harvest.md` with `- [decision|discovery] <title>: <body>` lines (emoji → obs_type: ⚖️→decision, 🔵→discovery; drop other emojis).

If MCP unavailable / zero observations / errors: write `.devt/state/claude-mem-skipped.txt` with `reason=<not_installed|mcp_unavailable|corpus_empty|task_unrelated_to_history>` (one of those four enum values; free-form rejected). Example: `printf 'reason=mcp_unavailable\nattempted_at=%s\n' "$(date -u +%FT%TZ)" > .devt/state/claude-mem-skipped.txt`. For `task_unrelated_to_history`, include a `details=` line.

```bash
HARVEST=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-claude-mem-harvest)
if [ "$(echo "$HARVEST" | jq -r '.ok')" != "true" ]; then
  echo "BLOCKED: claude-mem decision artifact missing — $(echo "$HARVEST" | jq -r '.reason')"
  exit 1
fi
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" memory suggest >/dev/null 2>&1 || true
```

Best-effort. Never fails the workflow.

</step>

<step name="finalize" gate="final status is reported to user">

**Knowledge-candidates-tagged gate.** Before completing, assert that the orchestrator either surfaced `#KNOWLEDGE-CANDIDATE` lines in `scratchpad.md` during work OR declared none via `knowledge-candidates-none.txt` with a structured reason. Greenfield calibration #2 finding 6a#1: candidates described in prose but never tagged → never reached the curator harvester. Runs BEFORE the scratchpad truncate below — that order matters because the truncate would otherwise erase the very tags the gate checks for.

**Dispatch-hygiene post-hoc gate (greenfield calibration #12, S1).** Block finalize on any in-session raw devt:* dispatches. CC doesn't enforce PreToolUse Task-deny; this is the post-hoc enforcement.

```bash
RD_GATE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-no-raw-dispatches-this-session)
if echo "$RD_GATE" | jq -e '.ok == false' >/dev/null 2>&1; then
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=finalize status=BLOCKED verdict=FAILED
  echo "BLOCKED: $(echo "$RD_GATE" | jq -r '.reason')"
  exit 0
fi
```

First aggregate any candidates the programmer surfaced inside `impl-summary*.md` (covered by the same scanner as `review-lane-*.md`/`review.md`). Without this hop, tags written into the impl summary stay stranded and the gate trips with `tag_count: 0` despite valid candidates existing — greenfield calibration #8 evidence.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state aggregate-knowledge-candidates >/dev/null 2>&1 || true
KC_GATE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-knowledge-candidates-tagged)
if echo "$KC_GATE" | jq -e '.ok == false' >/dev/null 2>&1; then
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=finalize status=BLOCKED verdict=FAILED
  echo "BLOCKED: $(echo "$KC_GATE" | jq -r '.reason')"
  exit 0
fi
```

When the gate trips: re-read impl-summary.md, identify non-obvious patterns surfaced during implementation but not tagged, append `#KNOWLEDGE-CANDIDATE: [type=...] <summary>` lines to scratchpad.md, then re-enter finalize. If genuinely none qualify, write the structured none-declaration: `printf 'reason=task_too_routine\ndeclared_at=%s\n' "$(date -u +%FT%TZ)" > .devt/state/knowledge-candidates-none.txt`.

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
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state truncate-artifact scratchpad.md
```

The second line clears ephemeral PREFLIGHT lines from `scratchpad.md` so the next workflow in the same session starts clean. Quick workflows don't have a `review_deferred` step, but the scratchpad still accumulates pre-flight-guard coverage records during the run.

Report to the user:

- **Implementation**: files modified/created (from impl-summary.md)
- **Tests**: pass/fail counts (from `test-summary.json::tests.{passed,failed}_count`)
- **Review verdict**: APPROVED / APPROVED_WITH_NOTES
- **Review score**: N/100
- **Iterations**: how many implement-review cycles occurred
- **Overall status**: DONE | DONE_WITH_CONCERNS | BLOCKED
  </step>

---

<deviation_rules>
Agents follow Rules 1-4 from the programmer agent's deviation framework (see `agents/programmer.md`):

1. **Rule 1 (Auto-fix): Bugs** — Logic errors, type errors, null references, security flaws. Fix inline.
2. **Rule 2 (Auto-fix): Missing critical functionality** — Missing error handling, input validation, auth checks. Fix inline.
3. **Rule 3 (Auto-fix): Blocking issues** — Missing dependency, broken imports, build errors. Fix inline.
4. **Rule 4 (STOP): Architectural changes** — Workflow STOPS and surfaces to user.

**Attempt limit**: 3 auto-fix attempts per issue, then DONE_WITH_CONCERNS. Track as `[Rule N - Type]`.

**Scope**: Only auto-fix issues directly caused by the current task. Pre-existing issues are logged to `.devt/state/scratchpad.md` under category `Deferred`.
</deviation_rules>

<success_criteria>

- Implementation is complete (impl-summary.md status is DONE or DONE_WITH_CONCERNS)
- All tests pass (`test-summary.json::tests.failed_count = 0`)
- Code review is APPROVED or APPROVED_WITH_NOTES (score >= 80)
- Final status: **DONE** or **DONE_WITH_CONCERNS**
  </success_criteria>
