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
SCOPE_HINT=$(jq -c '.suggested_reading // []' .devt/state/preflight-brief.json 2>/dev/null || echo '[]')
SCOPE_TRUST=$(jq -c '{trust: (.graph_stats.trust // "empty"), lag_commits: .staleness.lag_commits, fresh: (.staleness.fresh // false)}' .devt/state/preflight-brief.json 2>/dev/null || echo '{}')

# Mechanical staleness override — force scope_trust.trust='sparse' + write a suppression artifact when
# graph_stats.state=ready AND (lag_commits is null OR exceeds threshold). Bash-mechanical because the
# prior prose-only spec ("In autonomous mode, force sparse") was found violated in field validation:
# the orchestrator wrote scope_trust before the prose, then never re-wrote.
GRAPHIFY_STATE=$(jq -r '.graph_stats.state // "not_ready"' .devt/state/preflight-brief.json 2>/dev/null || echo "not_ready")
STALE_THRESHOLD=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" config get graphify.stale_threshold 2>/dev/null | jq -r '.value // 30')
LAG=$(echo "$SCOPE_TRUST" | jq -r '.lag_commits // "null"')
SUPPRESS=""
if [ "$GRAPHIFY_STATE" = "ready" ]; then
  if [ "$LAG" = "null" ]; then
    SUPPRESS="lag_commits=null, state=ready (unreachable SHA / shallow clone)"
  elif [ "$LAG" -gt "$STALE_THRESHOLD" ] 2>/dev/null; then
    SUPPRESS="lag_commits=$LAG > stale_threshold=$STALE_THRESHOLD"
  fi
fi
if [ -n "$SUPPRESS" ]; then
  SCOPE_TRUST=$(echo "$SCOPE_TRUST" | jq '.trust = "sparse"')
  printf '%s — %s\n' "$(date -u +%FT%TZ)" "$SUPPRESS" > .devt/state/staleness-suppressed.txt
fi

node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update scope_hint_json="${SCOPE_HINT}" scope_trust_json="${SCOPE_TRUST}"
```

**Staleness gate** — If `preflight-brief.json::staleness.lag_commits > graphify.stale_threshold` (default 30) OR (`graph_stats.state` is `ready` AND `staleness.lag_commits` is `null`), prompt the user via AskUserQuestion BEFORE the programmer dispatch: "Graphify graph is {lag_commits ?? 'unknown'} commits behind HEAD; symbol-to-file mappings may be stale. Refresh now?" Options: **Refresh (recommended)** — pause for `graphify update .`, re-run preflight, continue; **Proceed with stale graph** — continue with `scope_trust.fresh=false`; **Cancel** — STOP with BLOCKED. In autonomous mode, force `scope_trust.trust="sparse"` and proceed. Skip only when graphify is disabled — a null `lag_commits` while `state=ready` (e.g., unreachable SHA, shallow clone) now triggers the prompt instead of silently disabling the gate.

**Graphify scan-prep gate** — When the task is non-trivial AND the graph is dense AND blast radius is substantial, instruct the orchestrator to write a fresh `.devt/state/graph-impact.md` via two MCP calls. Field-validated threshold (greenfield-api forensic): `direct_dependents_count >= 10 AND graph_stats.trust == "dense"`. Below the threshold (or graphify disabled): skip; agents fall back to grep + scope_hint. The decision tree is bash; the MCP calls are the orchestrator's responsibility:

```bash
DEPENDENTS=$(jq -r '.blast.direct_dependents_count // 0' .devt/state/preflight-brief.json 2>/dev/null || echo 0)
TRUST=$(jq -r '.graph_stats.trust // "empty"' .devt/state/preflight-brief.json 2>/dev/null || echo "empty")
SYMBOLS_JSON=$(jq -c '.topic.symbols // []' .devt/state/preflight-brief.json 2>/dev/null || echo '[]')
SYMBOLS_COUNT=$(echo "$SYMBOLS_JSON" | jq 'length')
if [ "$TRUST" = "dense" ] && [ "$DEPENDENTS" -ge 10 ] && [ "$SYMBOLS_COUNT" -gt 0 ]; then
  CENTRAL_SYMBOL=$(echo "$SYMBOLS_JSON" | jq -r '.[0]')
  echo "graphify_scan_prep: ACTIVE — central=$CENTRAL_SYMBOL dependents=$DEPENDENTS trust=$TRUST"
elif [ "$TRUST" = "dense" ] && [ "$SYMBOLS_COUNT" = "0" ]; then
  echo "graphify_scan_prep: RECOVERY — symbols=0 trust=dense; orchestrator must call query_graph(task_text) to resolve synthetic symbols, then proceed with get_neighbors + blast_radius on the top result"
else
  REASON="dependents=$DEPENDENTS trust=$TRUST symbols=$SYMBOLS_COUNT (need dense+≥10+symbols)"
  echo "graphify_scan_prep: SKIP — $REASON"
  printf '%s\n' "$REASON" > .devt/state/graphify-skip-reason.txt
fi
```

When the bash echo prints `ACTIVE`, the orchestrator MUST execute these two MCP calls and concatenate the output into `.devt/state/graph-impact.md`:

1. `mcp__devt-graphify__get_neighbors({symbol: "<CENTRAL_SYMBOL>", direction: "in", depth: 2})` — caller set grep can't reliably enumerate (cross-language, dynamic dispatch).
2. `mcp__devt-graphify__blast_radius({symbols: ["<CENTRAL_SYMBOL>"]})` — aggregate structural risk.

Format `graph-impact.md` with sections `# Graph Impact — <task>` / `## Caller set (get_neighbors)` / `## Blast radius`. Sub-agents will Read this file during their scan + implement phases. When the bash printed `SKIP`, `graphify-skip-reason.txt` was written above as the explicit decision artifact and no MCP call is made — downstream agents fall back to grep+scope_hint.

**When the bash echo prints `RECOVERY`** — topic extraction returned 0 symbols on a dense graph (the F12 snake_case fallback also missed). Orchestrator MUST first call `mcp__devt-graphify__query_graph({text: "${TASK_DESCRIPTION}", limit: 5})` to resolve synthetic symbols against the graph, then proceed with `get_neighbors` + `blast_radius` using the top result's label as `CENTRAL_SYMBOL`. Write `graph-impact.md` with an additional `## Fuzzy symbol resolution` section listing the query and top results.

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

Dispatch the programmer agent:

```
Task(subagent_type="devt:programmer", model="{models.programmer}", prompt="
  <context>
    <files_to_read>.devt/rules/coding-standards.md, .devt/rules/quality-gates.md, .devt/rules/architecture.md, CLAUDE.md</files_to_read>
    <!-- KEEP IN SYNC: this <governing_rules> block is duplicated across the
         programmer, code-reviewer, verifier, and researcher dispatch templates
         in workflows/{dev-workflow,quick-implement,code-review,research-task}.md.
         When one changes, update the others. governing_rules comes from the
         init payload; omit this block entirely when content is empty (agent
         falls back to on-disk Reads of CLAUDE.md + .devt/rules/*.md). -->
    <governing_rules rules_hash=\"{governing_rules.rules_hash}\">
      <claude_md>{governing_rules.content[\"CLAUDE.md\"]}</claude_md>
      <coding_standards>{governing_rules.content[\".devt/rules/coding-standards.md\"]}</coding_standards>
      <architecture>{governing_rules.content[\".devt/rules/architecture.md\"]}</architecture>
      <quality_gates>{governing_rules.content[\".devt/rules/quality-gates.md\"]}</quality_gates>
    </governing_rules>
    <!-- KEEP IN SYNC: this <guardrails_inline> block is duplicated in the
         programmer and code-reviewer dispatch templates. When one changes,
         update the other. inline_guardrails comes from the init payload;
         omit this block entirely when it is null (agent falls back to on-disk
         Reads of the three guardrail files). -->
    <guardrails_inline>
      <golden_rules>{inline_guardrails["golden-rules.md"]}</golden_rules>
      <engineering_principles>{inline_guardrails["engineering-principles.md"]}</engineering_principles>
      <generative_debt_checklist>{inline_guardrails["generative-debt-checklist.md"]}</generative_debt_checklist>
    </guardrails_inline>
    <!-- KEEP IN SYNC: the <memory_signal> block + its orchestrator-prep step
         are duplicated across programmer + code-reviewer + verifier dispatches
         in dev-workflow.md, code-review.md, and quick-implement.md. When the
         CLI shape or block position changes, update all five. -->
    <memory_signal>{memory_signal_json}</memory_signal>
    <scope_hint>{scope_hint_json}</scope_hint>
    <scope_trust>{scope_trust_json}</scope_trust>
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

Dispatch the tester agent:

```
Task(subagent_type="devt:tester", model="{models.tester}", prompt="
  <context>
    <files_to_read>.devt/rules/testing-patterns.md, .devt/rules/quality-gates.md, CLAUDE.md</files_to_read>
    <!-- KEEP IN SYNC: this <governing_rules> block is duplicated across the
         programmer, tester, code-reviewer, verifier, and researcher dispatch
         templates. When one changes, update the others. -->
    <governing_rules rules_hash=\"{governing_rules.rules_hash}\">
      <claude_md>{governing_rules.content[\"CLAUDE.md\"]}</claude_md>
      <quality_gates>{governing_rules.content[\".devt/rules/quality-gates.md\"]}</quality_gates>
      <testing_patterns>{governing_rules.content[\".devt/rules/testing-patterns.md\"]}</testing_patterns>
    </governing_rules>
    <!-- KEEP IN SYNC: tester preloads only golden-rules.md from the guardrails set. -->
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

If MCP unavailable / zero observations / errors: write `.devt/state/claude-mem-skipped.txt` with a one-line reason. This signals the gate the orchestrator considered the pre-step.

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
