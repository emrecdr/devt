# Research Task

Investigate implementation approaches before planning or coding.

<purpose>
Research the best approach for a task by scanning the codebase, identifying patterns,
and producing a prescriptive recommendation. This step prevents wrong approaches
and surfaces pitfalls before any code is written.
</purpose>

<prerequisites>
- `.devt/rules/` directory exists with coding-standards.md, architecture.md
- `${CLAUDE_PLUGIN_ROOT}` is set (devt plugin is loaded)
- `node` is available on PATH
</prerequisites>

<available_agent_types>

- devt:researcher — technical investigation specialist, READ-ONLY (Read, Bash, Glob, Grep)
  </available_agent_types>

<agent_skill_injection>
Before dispatching the researcher agent, read `resolved_skills.researcher` from the compound `init` output. Pre-resolved by `init.cjs::resolveSkills` — `.devt/config.json::agent_skills.researcher` overrides; skill-index.yaml adds `strategic-analysis` at STANDARD+. The researcher's base skills (`memory-pre-flight`, `codebase-scan`) are preloaded via agent frontmatter and are never re-listed; when the resolved list is empty, inject `<agent_skills>(none — defaults preloaded via agent frontmatter)</agent_skills>`.
</agent_skill_injection>

<process>

<step name="init" gate="project context loaded">
## Step 1: Initialize

```bash
CTX=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state workflow-context-init --workflow-type=research --scope="${TASK_DESCRIPTION}" --primary-branch="${PRIMARY_BRANCH:-main}")
PREREQ_FAILED=$(printf '%s\n' "$CTX" | jq -r '.prerequisite_failed // empty')
if [ -n "$PREREQ_FAILED" ]; then
  echo "BLOCKED: compound init failed — workflow-context-init prerequisite ${PREREQ_FAILED}: $(printf '%s\n' "$CTX" | jq -r '.detail // ""')"
  exit 1
fi
# Preflight freshness gate stays separate (the wrapper gathers; the gate enforces).
PFRESH=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-preflight-fresh)
if [ "$(printf '%s\n' "$PFRESH" | jq -r '.ok')" != "true" ]; then
  echo "BLOCKED: preflight-brief is stale — $(printf '%s\n' "$PFRESH" | jq -r '.reason')"
  exit 1
fi
```

The wrapper performs `init workflow`, activates the workflow (`workflow_type=research`), runs `preflight generate "${TASK_DESCRIPTION}"` (the **Topic Pre-Flight Brief** — researcher reads it FIRST; REJ tombstones act as "we already evaluated and rejected this" markers it cites when approaches are out of scope), computes the `memory query "${TASK_DESCRIPTION}" --signal=3 --json-compact` aggregate, runs `preflight scope-cache` (computing `scope_hint` + `scope_trust` with the mechanical staleness override — writes `.devt/state/staleness-suppressed.txt` when `graph_stats.state=ready` AND `lag_commits` is null or exceeds `graphify.stale_threshold`), and runs `state evict-graphify`. All cached in `workflow.yaml`; fill the researcher dispatch's `{governing_rules}` / `{models}` / `<scope_hint>` / `<scope_trust>` / `<memory_signal>` placeholders from `$CTX.init` + those caches.

`state evict-graphify` clears stale `graph-impact.md` + related MCP-response artifacts so this research session doesn't inherit a different topic's blast radius. **Note**: `graphify-impact-plan.json` is **NOT** evicted — it carries the args+tier audit trail and survives `state reset` via RESET_EXEMPT.

**Staleness gate** — When `$CTX.staleness_tier ∈ {stale, unknown_lag}` (`staleness.lag_commits > graphify.stale_threshold`, OR `graph_stats.state` is `ready` AND `staleness.lag_commits` is `null`), prompt the user via AskUserQuestion BEFORE the researcher dispatch: "Graphify graph is {lag_commits ?? 'unknown'} commits behind HEAD; codebase patterns may be stale. Refresh now?" Options: **Refresh (recommended)** — pause for `graphify update .`, re-run preflight, continue; **Proceed with stale graph** — continue with `scope_trust.fresh=false`; **Cancel** — STOP with BLOCKED. In autonomous mode, force `scope_trust.trust="sparse"` and proceed. Skip only when graphify is disabled — a null `lag_commits` while `state=ready` (e.g., unreachable SHA, shallow clone) now triggers the prompt instead of silently disabling the gate.

**Graphify scan-prep gate** — When the graph is dense AND blast radius is substantial AND topic symbols resolved, instruct the orchestrator to write a fresh `.devt/state/graph-impact.md` via two MCP calls. Threshold matches dev-workflow's field-validated bar. Below the threshold (or graphify disabled): skip; researcher falls back to grep + scope_hint.

```bash
DEPENDENTS=$(jq -r '.blast.direct_dependents_count // 0' .devt/state/preflight-brief.json 2>/dev/null || echo 0)
TRUST=$(jq -r '.graph_stats.trust // "empty"' .devt/state/preflight-brief.json 2>/dev/null || echo "empty")
SYMBOLS_JSON=$(jq -c '.topic.symbols // []' .devt/state/preflight-brief.json 2>/dev/null || echo '[]')
SYMBOLS_COUNT=$(printf '%s\n' "$SYMBOLS_JSON" | jq 'length')
if [ "$TRUST" = "dense" ] && [ "$DEPENDENTS" -ge 10 ] && [ "$SYMBOLS_COUNT" -gt 0 ]; then
  CENTRAL_SYMBOL=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" preflight pick-central-symbol "$SYMBOLS_JSON" "${TASK_DESCRIPTION:-}" 2>/dev/null | head -1)
  [ -z "$CENTRAL_SYMBOL" ] && CENTRAL_SYMBOL=$(printf '%s\n' "$SYMBOLS_JSON" | jq -r '.[0]')
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

1. **`mcp__plugin_devt_devt-graphify__blast_radius({symbols: ["<CENTRAL_SYMBOL>"]})`** — first call, impact map with `direct_dependents`.
2. **Drill-down on top-3 dependents** (F16). Parse `direct_dependents`, take top-3 by impact_size, call `mcp__plugin_devt_devt-graphify__get_neighbors({symbol: "<DEP>", direction: "in", depth: 2})` for each. The researcher uses drill-down data to find existing usage patterns across the most-affected modules without grep-discovery.

Format `graph-impact.md` with sections `# Graph Impact — <task>` / `## Blast radius — <CENTRAL_SYMBOL>` / `## Drill-down: <dep1> [call: <correlation_id>]` / `## Drill-down: <dep2> [call: <correlation_id>]` / `## Drill-down: <dep3> [call: <correlation_id>]`. The `correlation_id` is the `_meta.correlation_id` field returned by each `get_neighbors` MCP response (8-char hex); omit the `[call: ...]` suffix when the field is absent. The researcher Reads this file when present. When the bash printed `SKIP`, `graphify-skip-reason.txt` was written above and no MCP call is made — researcher falls back to grep+scope_hint.

**When the bash echo prints `RECOVERY`** — topic extraction returned 0 symbols on a dense graph. Orchestrator MUST first call `mcp__plugin_devt_devt-graphify__query_graph({text: "${TASK_DESCRIPTION}", limit: 5})` to resolve synthetic symbols, then proceed with `get_neighbors` + `blast_radius` using the top result's label as `CENTRAL_SYMBOL`. Write `graph-impact.md` with an additional `## Fuzzy symbol resolution` section.

**Decision artifact assertion** — hard-fail if the orchestrator skipped writing either artifact:

```bash
ASSERT=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-graphify-decision)
if [ "$(printf '%s\n' "$ASSERT" | jq -r '.ok')" != "true" ]; then
  echo "BLOCKED: graphify decision artifact missing — $(printf '%s\n' "$ASSERT" | jq -r '.reason')"
  exit 1
fi
```

Read .devt/rules/ for project conventions.
Read CLAUDE.md if it exists.
Read .devt/state/decisions.md if it exists (from /devt:workflow --mode=clarify).
Read `${CLAUDE_PLUGIN_ROOT}/references/council-offramp.md` — when researcher findings are inconclusive or contested enough to warrant offering `/devt:council` as a resolution path (threshold in §1; template in §2; capture in §3.2 — caller is `/devt:research`).
</step>

<step name="scope_check" gate="research scope determined">
## Step 2: Scope Check

Is research actually needed?

- **Known pattern** (simple CRUD, config change, well-documented feature): Skip research. Tell user: "This is a well-known pattern. Proceed directly with /devt:plan or /devt:implement."
- **Unfamiliar domain** (new integration, complex algorithm, multiple approaches): Proceed with research.
- **Multiple valid approaches** (architecture decision needed): Proceed with research.

If skipping, report why and suggest next command. Do NOT dispatch the researcher for trivial tasks.
</step>

<step name="research" gate="research.md is written to .devt/state/">
## Step 3: Dispatch Researcher

<!-- BEGIN dispatch:researcher:research -->
<!-- EDIT-SOURCE: templates/dispatch/envelopes/researcher-research.tmpl.md -->
Task(subagent_type="devt:researcher", model="{models.researcher}", prompt="
<context>
<governing_rules rules_hash=\"{governing_rules.rules_hash}\">
  <claude_md>{governing_rules.content[\"CLAUDE.md\"]}</claude_md>
  <coding_standards>{governing_rules.content[\".devt/rules/coding-standards.md\"]}</coding_standards>
  <architecture>{governing_rules.content[\".devt/rules/architecture.md\"]}</architecture>
</governing_rules>
<scope_hint>{scope_hint_json}</scope_hint>
<scope_trust>{scope_trust_json}</scope_trust>
<memory_signal>{memory_signal_json}</memory_signal>
<graph_impact>Read .devt/state/graph-impact.md if it exists — pre-computed caller set + blast radius for the topic's central symbol. When absent, .devt/state/graphify-skip-reason.txt explains why (orchestrator already wrote one of these before dispatch).</graph_impact>
<spec>Read .devt/state/spec.md (if exists — from /devt:specify)</spec>
<decisions>Read .devt/state/decisions.md (if exists)</decisions>
<template>${CLAUDE_PLUGIN_ROOT}/templates/research-template.md</template>
<agent_skills>{injected from .devt/config.json if available}</agent_skills>
</context>
<task>
Research implementation approaches for: {task_description}
Investigate the codebase for existing patterns, recommend an approach, identify pitfalls.

Your tool surface does not include `mcp__*graphify*`. Use the `<scope_hint>` block (derived from preflight Brief blast-radius and governing-doc affects_paths) as the high-signal starting set when looking for existing patterns or pitfalls to flag. Validate with Grep/Read against the actual implementation. When `<scope_trust>.trust` is `empty`, broaden Glob/Grep exploration and don't claim "no prior art exists" based on scope_hint alone.

**Capture knowledge candidates** (load-bearing — not optional, do this BEFORE writing research.md): per your `knowledge_candidates` step, if investigation surfaces non-obvious facts worth promoting to permanent memory (a recurring trap, a constraint not documented anywhere, a verified rule of thumb, a pattern that explains "why does the codebase do it this way"), append `#KNOWLEDGE-CANDIDATE: [type=decision|concept|flow|rejected] <one-line summary>` lines to `.devt/state/scratchpad.md`. Each tag passes the 5-filter test: specificity, durability, non-obviousness, evidence, actionability. When none qualify, surface that decision in research.md.
</task>
Write findings to .devt/state/research.md
")
<!-- END dispatch:researcher:research -->

**Claim-check (Q11)**: mechanically verify the researcher wrote its declared output:

```bash
ARTIFACT_CHECK=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-artifact-present researcher)
if [ "$(printf '%s\n' "$ARTIFACT_CHECK" | jq -r '.ok')" != "true" ]; then
  echo "[BLOCKED] devt: $(printf '%s\n' "$ARTIFACT_CHECK" | jq -r '.reason')"
fi
```

Gate: Read .devt/state/research.md and check status:

- DONE: proceed to present
- NEEDS_CONTEXT: ask user for clarification, re-dispatch
- DONE_WITH_CONCERNS: proceed but flag concerns
  </step>

<step name="present" gate="user has seen findings">
## Step 4: Present Findings

Show the user:

- **Summary**: recommended approach (2-3 sentences)
- **Key finding**: most important pattern/pitfall discovered
- **Open questions**: anything that needs user decision

If open questions exist, ask the user via AskUserQuestion.

**Council offramp**: When the researcher returned `DONE_WITH_CONCERNS`, OR an open question trips the threshold in `${CLAUDE_PLUGIN_ROOT}/references/council-offramp.md` §1, use the offramp template from §2 — include the "Run /devt:council" option in the AskUserQuestion list. Council is especially valuable here because the researcher already laid the factual groundwork the advisors need, and `.devt/state/research.md` becomes the primary anchor for the council's `validation_material`. Soft cap: at most 1 council invocation per `/devt:research` session.

When the user picks the council option, follow `${CLAUDE_PLUGIN_ROOT}/references/council-offramp.md` §3 to invoke and resume. After the council returns, capture the verdict per §3.2 (research caller appends a `## Council Verdict on {decision}` section to `.devt/state/research.md`).

Append answers (and the council verdict link, if applicable) to .devt/state/research.md.
</step>

<step name="next">
## Step 5: Suggest Next Step

Based on research completeness:

- If approach is clear: "Research complete. Run /devt:plan to create an implementation plan, or /devt:workflow to start implementing."
- If concerns flagged: "Research has concerns. Review .devt/state/research.md before proceeding."
- If user provided answers to open questions: update research.md and suggest proceeding.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update active=false phase=complete status=DONE
```
</step>

</process>

<deviation_rules>
1. **STOP: scope creep** — If the research reveals the task is actually multiple independent tasks, report this to the user and suggest decomposition. Do not try to research everything.
2. **STOP: insufficient codebase** — If the codebase doesn't have enough context to make a recommendation (e.g., greenfield with no existing patterns), say so explicitly rather than guessing.
3. **Auto-fix: blocked researcher** — If the researcher agent returns BLOCKED or NEEDS_CONTEXT, provide the missing context from .devt/rules/ or CLAUDE.md and retry once. If still blocked, escalate to user.
4. **STOP: research inconclusive** — If no clear recommendation emerges after scanning, present the trade-offs honestly rather than forcing a pick. Use the council offramp (`${CLAUDE_PLUGIN_ROOT}/references/council-offramp.md` §2) to give the user a structured resolution path beyond binary "pick A or B" — council is especially valuable here because the researcher already laid the factual groundwork the advisors need to ground their reasoning.
</deviation_rules>

<success_criteria>

- .devt/state/research.md exists with recommended approach
- All open questions resolved (or explicitly deferred)
- User has reviewed summary
  </success_criteria>

## Memory layer integration

Researcher consults `.devt/memory/concepts/` and `.devt/memory/decisions/` BEFORE recommending
an approach — `node bin/devt-tools.cjs memory query <topic>` and `memory affects <relevant-path>`
surface governing rules. Recommendations matching active REJ tombstones are pre-filtered. When
research findings stabilize into a reusable Concept ("here's the auth domain model"), the
researcher tags `#KNOWLEDGE-CANDIDATE: [type=concept] <summary>` for curator promotion.
research.md's `links:` field is now populated with related ADR/CON IDs.
