# dev-workflow — COMPLEX-only tier steps (lazy-loaded)

Loaded by `workflows/dev-workflow.md`'s `load_tier_steps` step ONLY when the assessed tier is COMPLEX (in addition to `dev-workflow.standard.md`). Each `<step>` below executes at its `TIER-STEP` insertion point in the spine's pipeline order — the bodies were relocated VERBATIM from dev-workflow.md; their `gate="..."` contracts, dispatches, and artifacts are unchanged. SIMPLE/STANDARD/TRIVIAL never load this file.

<available_agent_types>
Dispatched from this tier file (full roster + tool surfaces in the spine `dev-workflow.md`):

- `devt:researcher` — technical investigation specialist, READ-ONLY (Read, Bash, Glob, Grep)
- `devt:architect` — structural review specialist, READ-ONLY (Read, Bash, Glob, Grep)
- `devt:curator` — memory-layer quality maintenance specialist (Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion)
</available_agent_types>

## auto_research_plan (COMPLEX only; insertion: after risk_warning, before scan)

<step name="auto_research_plan" gate="research and plan exist for COMPLEX tasks">

_Only applies if complexity tier is COMPLEX._

**Arch-Health Pre-Decision**: Before dispatching the researcher, evaluate whether to also fire an architecture health scan in parallel. This was historically Step 2.7's job, but firing it alongside the researcher (instead of after the plan) lets the inline plan consume both artifacts in one pass and shaves a serial subagent round-trip off COMPLEX flows.

**Risk signals** (if ANY are true from `.devt/state/scan-results.md`, recommend the scan):
- Scan results touch 3+ modules or services
- Scan results show existing coupling or boundary violations in the affected area
- Task mentions a new architectural pattern (new service, new layer, new integration)
- Task modifies shared infrastructure (core/, base classes, middleware)
- Task changes database schema across multiple services

**If any signal trips, present via AskUserQuestion BEFORE the parallel dispatch:**

```yaml
question: "This task has architectural risk signals. Run an architecture health scan in parallel with research?"
header: "Architecture Health Scan"
multiSelect: false
options:
  - label: "Yes — scan in parallel (Recommended)"
    description: "Dispatch arch-health alongside the researcher. Findings feed into the plan and the architect review."
  - label: "Skip — research only"
    description: "Dispatch only the researcher. Plan will not consider existing architectural debt."
```

If no risk signals trip, skip the prompt and dispatch only the researcher.

**Auto-Research (parallel dispatch)**: If no `.devt/state/research.md` exists, dispatch the researcher. If arch_health was opted-in AND `.devt/state/arch-health-scan.md` does not exist, dispatch the architect alongside it. Both dispatches MUST be issued in **one message with two Task tool calls** to actually run in parallel — sequential Task calls serialize.

**Discoverability tip (Q11 + Q8 contract)**: When the canonical envelope below isn't sufficient (custom parallelism, mid-task resume, or hand-rolled lane scope), use `node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" dispatch render-filled <agent>:auto` to generate the paste-ready envelope with current state + governing rules + guardrails substituted. See `skills/dispatch-helpers/SKILL.md` for the lane-customization + SendMessage-resume patterns.

**Orchestrator-prep — read cached `memory_signal`**. The wrapper cached `memory_signal_json` at context_init; read it back so the researcher investigates with the project's REJ-tombstone / ADR governance signal instead of re-recommending an already-rejected approach:

```bash
MEMORY_SIGNAL=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state read | jq -r '.memory_signal_json // "{}"')
```

Substitute `MEMORY_SIGNAL` into the researcher's `<memory_signal>` block below.

<!-- parallel-dispatch: researcher + architect (arch_health mode). Both must
     be in the SAME message for true parallelism per the Anthropic Task
     parallelism contract. -->

```
<!-- BEGIN dispatch:researcher:dev -->
<!-- EDIT-SOURCE: templates/dispatch/envelopes/researcher.tmpl.md -->
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
    <spec>Read .devt/state/spec.md (if exists)</spec>
    <decisions>Read .devt/state/decisions.md (if exists)</decisions>
    <template>${CLAUDE_PLUGIN_ROOT}/templates/research-template.md</template>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
  </context>
  <task>Research implementation approaches for: {task_description}

  **Capture knowledge candidates** (load-bearing — not optional, do this BEFORE writing research.md): per your `knowledge_candidates` step, if investigation surfaces non-obvious facts worth promoting to permanent memory (recurring trap, undocumented constraint, verified rule of thumb, "why does the codebase do it this way" pattern), append `#KNOWLEDGE-CANDIDATE: [type=decision|concept|flow|rejected] <one-line summary>` lines to `.devt/state/scratchpad.md`. Each tag passes: specificity, durability, non-obviousness, evidence, actionability.
  </task>
  Write findings to .devt/state/research.md
")
<!-- END dispatch:researcher:dev -->
```

```
# Only when arch_health was opted-in above — dispatched in the SAME message as the researcher Task call.
<!-- BEGIN dispatch:architect:dev-arch-health -->
<!-- EDIT-SOURCE: templates/dispatch/envelopes/architect-dev-arch-health.tmpl.md -->
Task(subagent_type="devt:architect", model="{models.architect}", prompt="
  <context>
    <files_to_read>.devt/rules/architecture.md, .devt/rules/coding-standards.md</files_to_read>
<governing_rules rules_hash=\"{governing_rules.rules_hash}\">
      <claude_md>{governing_rules.content[\"CLAUDE.md\"]}</claude_md>
      <architecture>{governing_rules.content[\".devt/rules/architecture.md\"]}</architecture>
    </governing_rules>
<guardrails_inline>
      <golden_rules>{inline_guardrails[\"golden-rules.md\"]}</golden_rules>
      <engineering_principles>{inline_guardrails[\"engineering-principles.md\"]}</engineering_principles>
    </guardrails_inline>
    <scope_hint>{scope_hint_json}</scope_hint>
    <scope_trust>{scope_trust_json}</scope_trust>
    <scan_results>Read .devt/state/scan-results.md for affected modules — the plan does not exist yet, so scope from the scan.</scan_results>
    <skill>${CLAUDE_PLUGIN_ROOT}/skills/architecture-health-scanner/</skill>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
  </context>
  <task>
    Run an architecture health scan on the modules affected by this task.
    Focus on: layer violations, coupling issues, circular dependencies, and convention drift.
    Classify each finding as: true positive, false positive, or pre-existing.
    Report only findings relevant to the in-scope modules.

    **Capture knowledge candidates** (load-bearing — not optional): per your `knowledge_candidates` step, if your scan surfaces architectural rules / patterns worth promoting (cross-component invariants, "this layer cannot depend on that", non-obvious design constraints), append `#KNOWLEDGE-CANDIDATE: [type=decision|concept|flow|rejected] <one-line summary>` lines to `.devt/state/scratchpad.md`. Each tag passes: specificity, durability, non-obviousness, evidence, actionability.
  </task>
  Write findings to .devt/state/arch-health-scan.md
")
<!-- END dispatch:architect:dev-arch-health -->
```

If research.md already exists: skip the researcher dispatch.
If arch-health-scan.md already exists OR arch_health was skipped: skip the architect dispatch.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state advance-phase arch_health
```

**Open Questions gate** (applies when `.devt/state/research.md` exists with status DONE or DONE_WITH_CONCERNS):
- Scan for a `## Open Questions` section in research.md
- If any items are listed and NOT marked with ~~strikethrough~~, [RESOLVED], or [DEFERRED]:
  - Present the unresolved questions to the user via AskUserQuestion:
    ```yaml
    question: "These questions from research are unresolved. Resolve, defer, or proceed anyway?"
    header: "Unresolved Research Questions"
    multiSelect: false
    options:
      - label: "Resolve now"
        description: "Provide answers to the open questions before planning"
      - label: "Defer all"
        description: "Mark questions as [DEFERRED] in research.md and proceed"
      - label: "Proceed anyway"
        description: "Continue despite unresolved questions — risk of incomplete plan"
    ```
  - If user defers: mark each unresolved question as [DEFERRED] in research.md and proceed
  - If user resolves: update research.md with the answers and proceed
  - If user says proceed anyway: note the risk in plan.md and continue

**Auto-Plan**: If no `.devt/state/plan.md` exists, create one inline using the planning logic from `${CLAUDE_PLUGIN_ROOT}/workflows/create-plan.md` (Steps 3-5: analyze, plan, validate). Do NOT dispatch a separate subagent for planning — the main session creates the plan. The plan MUST read both `.devt/state/research.md` AND `.devt/state/arch-health-scan.md` (if it exists from the parallel dispatch above) — true-positive arch findings feed directly into plan scope so the architect review (Step 3) and programmer don't waste a cycle on debt that was already surfaced.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=plan status=DONE
```

If plan.md already exists: skip, use existing plan.

Present the plan summary to the user and ask to proceed:

```yaml
question: "Plan is ready. Proceed with implementation?"
header: "Plan Review"
multiSelect: false
options:
  - label: "Proceed"
    description: "{N tasks, M files to change}"
  - label: "Revise the plan"
    description: "Make changes before execution"
```
</step>

**Why**: COMPLEX tasks involve architectural decisions that should be planned and validated
before code is written. Skipping planning leads to rework.
</step>

## architect (COMPLEX only; insertion: pre-implement (after scan/baseline))

<step name="architect" gate="arch-review.md is written to .devt/state/">

_Skip this step if complexity is SIMPLE or STANDARD._

Dispatch the architect agent to review the proposed approach before implementation:

```
<!-- BEGIN dispatch:architect:dev-arch-review -->
<!-- EDIT-SOURCE: templates/dispatch/envelopes/architect-dev-arch-review.tmpl.md -->
Task(subagent_type="devt:architect", model="{models.architect}", prompt="
  <context>
    <files_to_read>.devt/rules/architecture.md, .devt/rules/coding-standards.md</files_to_read>
<governing_rules rules_hash=\"{governing_rules.rules_hash}\">
      <claude_md>{governing_rules.content[\"CLAUDE.md\"]}</claude_md>
      <architecture>{governing_rules.content[\".devt/rules/architecture.md\"]}</architecture>
    </governing_rules>
<guardrails_inline>
      <golden_rules>{inline_guardrails[\"golden-rules.md\"]}</golden_rules>
      <engineering_principles>{inline_guardrails[\"engineering-principles.md\"]}</engineering_principles>
    </guardrails_inline>
    <scope_hint>{scope_hint_json}</scope_hint>
    <scope_trust>{scope_trust_json}</scope_trust>
    <scan_results>Read .devt/state/scan-results.md</scan_results>
    <spec>Read .devt/state/spec.md (if exists — from /devt:specify). Review intended design against architecture rules.</spec>
    <plan>Read .devt/state/plan.md (if exists)</plan>
    <arch_health>Read .devt/state/arch-health-scan.md (if exists — from the parallel dispatch in Step 2.5). If present, factor existing violations into your review: flag any planned changes that would worsen existing issues.</arch_health>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
  </context>
  <task>
    Review the architectural approach for: {task_description}
    Assess module boundaries, dependency direction, and structural impact.
    Identify risks before implementation begins.

    **Capture knowledge candidates** (load-bearing — not optional): per your `knowledge_candidates` step, if your review surfaces architectural rules / patterns worth promoting (cross-component invariants, "this layer cannot depend on that", non-obvious design constraints), append `#KNOWLEDGE-CANDIDATE: [type=decision|concept|flow|rejected] <one-line summary>` lines to `.devt/state/scratchpad.md`. Each tag passes: specificity, durability, non-obviousness, evidence, actionability.
  </task>
  Write findings to .devt/state/arch-review.md
")
<!-- END dispatch:architect:dev-arch-review -->
```

**Claim-check (Q11)**: Before reading the artifact, mechanically verify the architect wrote its declared output. Catches the case where the architect returned a verbal summary without actually writing arch-review.md.

```bash
ARTIFACT_CHECK=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-artifact-present architect)
if [ "$(printf '%s\n' "$ARTIFACT_CHECK" | jq -r '.ok')" != "true" ]; then
  echo "[BLOCKED] devt: $(printf '%s\n' "$ARTIFACT_CHECK" | jq -r '.reason')"
fi
```

If the claim-check BLOCKED: architect did not write its declared output. Re-dispatch with explicit instruction to write the artifact before returning, OR SendMessage-resume if a budget wall is suspected. Do NOT advance phase=architect.

**Gate check**: Read `.devt/state/arch-review.md` and check status:

- DONE: proceed to implement
- DONE_WITH_CONCERNS: proceed to implement, but pass concerns to programmer as context:
  "Architecture review flagged concerns: [extract from arch-review.md]. Address these during implementation."
- PARTIAL: architect signaled incomplete work with `## Next-section: <name>` indicator. SendMessage-resume the architect with `<continue_from_section>` pointing at the remaining work. Do NOT advance to implement.
- BLOCKED: surface the blocking issue to the user and STOP
- NEEDS_CONTEXT: ask the user for clarification, then re-run this step

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=architect status=$STATUS
```

</step>

## curate (COMPLEX only; insertion: after harvest_observations)

<step name="curate" gate="curation-summary.md is written and .devt/memory/ is updated">

_Skip this step if complexity is SIMPLE or STANDARD._

**Pre-dispatch check**: Read `.devt/state/lessons.yaml` AND `.devt/memory/_suggestions.md` (the latter was refreshed by Step 9a).

- If lessons.yaml OR _suggestions.md has entries: dispatch curator
- If both empty/missing: skip curation entirely

Dispatch the curator agent. Both lessons and architectural candidates flow into the unified `.devt/memory/` layer through a single approval gate (AskUserQuestion per candidate):

**Pre-dispatch gate (B4)** — ensure the claude-mem harvest decision artifact exists before curator runs. Guards against silent skip of the harvest_observations step (field-validated 2026-05-26: orchestrator skipped the entire step, gate inside the step never fired). Relocating the assert here makes harvest required for curator to run.

```bash
HARVEST=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-claude-mem-harvest)
if [ "$(printf '%s\n' "$HARVEST" | jq -r '.ok')" != "true" ]; then
  echo "BLOCKED: claude-mem decision artifact missing — $(printf '%s\n' "$HARVEST" | jq -r '.reason')"
  exit 1
fi
```

```
<!-- BEGIN dispatch:curator:dev -->
<!-- EDIT-SOURCE: templates/dispatch/envelopes/curator.tmpl.md -->
Task(subagent_type="devt:curator", model="{models.curator}", prompt="
  <context>
    <files_to_read>.devt/state/lessons.yaml, .devt/memory/_suggestions.md (if exists), .devt/memory/lessons/*.md (existing)</files_to_read>
    <agent_skills>{injected from .devt/config.json — must include devt:memory-curation}</agent_skills>
  </context>
  <task>
    Evaluate two upstream sources and gate every promotion via AskUserQuestion:
    1. LESSONS: drafts in .devt/state/lessons.yaml. accept → write LES-NNNN.md
       to .devt/memory/lessons/. merge → update existing LES. reject → record reason.
    2. ARCHITECTURAL CANDIDATES: ⚖️/🔵 entries in .devt/memory/_suggestions.md.
       For each candidate that passes the 5-filter, present AskUserQuestion per
       memory-curation skill. NEVER write without explicit user approval.
    3. PRUNE: propose status:superseded for contradicted/stale lessons.
    4. After all writes, run `memory index` to refresh the FTS5 index.
  </task>
  Write summary to .devt/state/curation-summary.md
")
<!-- END dispatch:curator:dev -->
```

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=curate status=DONE
```

</step>

