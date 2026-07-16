# Development Workflow

Full development pipeline with complexity-tiered execution: scan, implement, test, review, docs, retro, curate.

---

<autonomous_mode>
## Autonomous Mode (`--autonomous`)

When the task description contains `--autonomous`, the workflow operates in autonomous mode:

**Auto-proceed when:**
- Quality gates pass (lint, typecheck, tests)
- Review verdict is APPROVED or APPROVED_WITH_NOTES (score >= 80)
- Verification status is VERIFIED
- No blockers or missing context

**Still pause for (even in autonomous mode):**
- Review score < 50 (BLOCKED — likely architectural issue)
- Any agent returns BLOCKED or NEEDS_CONTEXT
- Repair operator reaches PRUNE stage (deferred findings need user awareness)
- Stuck-signal: `node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" stuck check` reports `stuck: true` (≥3 deny records in current workflow session across sources `preflight`, `bash_destroy`, `no_verify`). Surface the chain via the returned `denies[]` array and pause — repeated guardrail denies signal the agent is fighting policy rather than progressing.
- Risk & simplicity warning triggers (simpler approach detected)
- Max iteration limits exceeded

**Detection:** Check if the task description string contains `--autonomous`. Strip the flag before passing the task to agents. Store `autonomous: true` in workflow state.

**Output in autonomous mode:** Display a compact status line at each phase transition instead of asking for confirmation:
```
--- Phase 3/7: Testing --- tester: DONE (4 tests, all passing). Proceeding...
```

### Granular Phase Control Flags

These flags provide fine-grained control over which phases execute. They are parsed from the task description string alongside `--autonomous` and stripped before passing the task to agents.

**`--to <phase>`** — Run phases up to and including the named phase, then stop.
- Example: `--to test` runs context_init, scan, plan, implement, test — then stops before review.
- Store `stop_at_phase=<phase>` in workflow state.
- At each phase transition, check: if the just-completed phase matches `stop_at_phase`, stop the workflow gracefully (set `active=false`, report progress, do NOT proceed to the next phase).
- Valid phases: context_init, scan, regression_baseline, plan, implement, test, review, verify, docs, retro, complete.

**`--only <phase>`** — Run only the named phase in isolation.
- Example: `--only review` runs only the review phase (skipping implement, test, etc.).
- Store `only_phase=<phase>` in workflow state.
- Skip all phases except `context_init` (always required for setup) and the named phase.
- At each phase transition, check: if the current phase is not `context_init` and not `only_phase`, skip it silently.
- Valid phases: context_init, scan, regression_baseline, plan, implement, test, review, verify, docs, retro, complete.

**`--chain`** — After completing the workflow, auto-invoke the next logical workflow step.
- Store `autonomous_chain=next` in workflow state (this field is a string enum, not boolean).
- Enables cross-workflow chaining (e.g., discuss -> plan -> implement) without manual `/devt:next` invocations.
- The next workflow step is determined by `/devt:next` routing logic.

**`--tdd`** — Enable test-driven development mode: tests are written BEFORE implementation.
- Reverses Step 4 (implement) and Step 5 (test): tester runs first with spec/task, programmer receives failing tests as context.
- Store `tdd_mode=true` in workflow state.
- Auto-injects `tdd-patterns` skill into both programmer and tester agents (regardless of `agent_skills` config).

**`--dry-run`** — Preview the workflow pipeline without executing any agents.
- Runs `context_init` and `assess` (complexity assessment) normally.
- After assessment: prints the planned pipeline steps, agent assignments, and model tiers.
- STOPS without executing — no agents dispatched. Resets state on exit so the workflow is not left locked.
- Useful for understanding what devt will do before committing to a full run.

**Detection and stripping:** Parse all flags from the task description string using the same pattern as `--autonomous`:
1. Check for `--to <phase>` — extract the phase name, validate against valid phases, strip from task description.
2. Check for `--only <phase>` — extract the phase name, validate against valid phases, strip from task description.
3. Check for `--chain` — strip from task description.
4. Check for `--tdd` — strip from task description.
5. Check for `--dry-run` — strip from task description.
6. If an invalid phase name is provided to `--to` or `--only`, STOP with error: "Invalid phase '{phase}'. Valid phases: context_init, scan, regression_baseline, plan, implement, test, review, verify, docs, retro, complete."
7. `--to` and `--only` are mutually exclusive. If both are present, STOP with error: "--to and --only cannot be used together."
</autonomous_mode>

## Tier Routing Manifest

Single-glance view of which steps fire for each complexity tier. Per-step `(STANDARD + COMPLEX)` annotations downstream remain operational — this manifest is the documentation surface, the inline annotations are the live gates.

| Tier         | Steps fired (in order)                                                          |
| ------------ | ------------------------------------------------------------------------------- |
| **TRIVIAL**  | 1 (inline execute + quality gates only — no subagents)                          |
| **SIMPLE**   | 1, 4, 5, 6, 9a                                                                  |
| **STANDARD** | 1, R, 2, 2.5, 4, 5, 5.5, 6, 6.5, 7+8, 9a, 10                                    |
| **COMPLEX**  | 1, R, RP, 2, 2.5, 3, 4, 5, 5.5, 6, 6.5, 7+8, 9a, 9b, 10                         |

Step legend: 1=assess, R=risk-warning, RP=auto-research+plan, 2=scan, 2.5=baseline, 3=arch-review, 4=implement, 5=test, 5.5=simplify, 6=review, 6.5=verify, 7+8=docs+retro (parallel), 9a=harvest, 9b=curate, 10=autoskill.

Tier is set in Step 1 and stored in `workflow.yaml::tier`. When in doubt, the inline annotation at each step heading is authoritative.

<prerequisites>
- `.devt/config.json` exists in project root (run `/init` first if not)
- `.devt/rules/` directory exists with project conventions
- `${CLAUDE_PLUGIN_ROOT}` is set (devt plugin is loaded)
- `node` is available on PATH
- The user has provided a task description as the command argument
</prerequisites>

<available_agent_types>
The following agent types can be dispatched via Task():

- `devt:programmer` — implementation specialist (Read, Write, Edit, Bash, Glob, Grep)
- `devt:tester` — testing specialist (Read, Write, Edit, Bash, Glob, Grep)
- `devt:code-reviewer` — code review specialist, READ-ONLY (Read, Bash, Glob, Grep)
- `devt:architect` — structural review specialist, READ-ONLY (Read, Bash, Glob, Grep)
- `devt:docs-writer` — documentation specialist (Read, Write, Edit, Bash, Glob, Grep)
- `devt:retro` — lesson extraction specialist (Read, Write, Bash, Glob, Grep)
- `devt:curator` — memory-layer quality maintenance specialist (Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion)
- `devt:verifier` — goal-backward verification specialist, READ-ONLY (Read, Bash, Glob, Grep)
- `devt:researcher` — technical investigation specialist, READ-ONLY (Read, Bash, Glob, Grep)
- `devt:debugger` — systematic debugging specialist, 4-phase investigation protocol (Read, Write, Edit, Bash, Glob, Grep)
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

Read `resolved_skills.<agent_type>` from the compound `init` output (`init.cjs::resolveSkills` — merges `.devt/config.json::agent_skills` with `${CLAUDE_PLUGIN_ROOT}/skill-index.yaml` defaults, config wins). Inject the list as the `<agent_skills>` block in the agent's task prompt. Frontmatter-preloaded skills are never re-listed; when the resolved list is empty, inject `<agent_skills>(none — defaults preloaded via agent frontmatter)</agent_skills>`.
</agent_skill_injection>

---

## Context Loading

Before any step, initialize the workflow:

<step name="context_init" gate="compound init succeeds and .devt/rules/ is readable">

> Context_init runs 8 substeps in order — bash + assert blocks under each. Substep markers are navigation anchors; the orchestrator must execute every block in sequence regardless of how they're labelled. KEEP IN SYNC with code-review.md::context_init.

### Substep 1: Compound workflow-context-init (single bundle)

Run the compound context-init wrapper ONCE. It performs `init workflow`, activates the workflow (`active=true workflow_type=dev phase=context_init`), runs `preflight generate` (Topic Pre-Flight Brief), computes + caches `memory_signal` / `scope_hint` / `scope_trust`, and evicts stale Graphify artifacts — collapsing what were ~6 sequential data-gathering CLI round-trips into one. Capture the JSON bundle into `CTX`:

```bash
CTX=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state workflow-context-init --workflow-type=dev --scope="${TASK_DESCRIPTION}" --primary-branch="${PRIMARY_BRANCH:-main}")
PREREQ_FAILED=$(printf '%s\n' "$CTX" | jq -r '.prerequisite_failed // empty')
if [ -n "$PREREQ_FAILED" ]; then
  echo "BLOCKED: compound init failed — workflow-context-init prerequisite ${PREREQ_FAILED}: $(printf '%s\n' "$CTX" | jq -r '.detail // ""')"
  exit 1
fi
```

The wrapper writes the same side-effect artifacts the inline substeps did — `preflight-brief.{md,json}` + `memory_signal_json` / `scope_hint_json` / `scope_trust_json` cached in `workflow.yaml` — so the dispatch envelopes that read those caches keep working unchanged.

Then load project context (orchestrator-side reads, NOT CLI round-trips):

- Read `${CLAUDE_PLUGIN_ROOT}/protocols/status-enum.md` for status values and transition mapping
- Read `${CLAUDE_PLUGIN_ROOT}/protocols/checkpoint-protocol.md` for checkpoint format
- Governing-rule file contents (`.devt/rules/coding-standards.md`, `architecture.md`, `quality-gates.md`, `testing-patterns.md`) are already in `$CTX.init.governing_rules.content` — no separate Reads needed to fill the dispatch envelopes. `CLAUDE.md` is carried as a by-reference stub: the harness auto-injects it into every subagent, so it is never inlined.
- Lessons live in the memory layer at `.devt/memory/lessons/` (LES-NNNN, FTS5-indexed). The Pre-Flight Brief surfaces task-relevant lessons via Lane F. Read `.devt/state/preflight-brief.md` and lift its "Related Operational Lessons" section into `learning_context`; empty if none (normal for new projects).
- Read `.devt/state/spec.md` if it exists (from `/devt:specify`) — primary requirements source (decisions, API design, test scenarios); else derive requirements from the task description.
- Read `.devt/state/plan.md` if it exists (from `/devt:plan`) — guides implementation (programmer reads it as context).
- Read `.devt/state/research.md` if it exists (from /devt:research) — if status `DONE_WITH_CONCERNS`, flag concerns to planner/programmer.
- Read `.devt/state/handoff.json` if it exists (from /devt:workflow --pause):
  - Restore phase, iteration, remaining_tasks as resume context; use `handoff.next_action` to guide resume.
  - Compare `handoff.last_commit` with `git rev-parse HEAD` — if they differ, warn the codebase may have changed since pause.
  - **Delete handoff.json after reading** — one-shot artifact; stale data causes false resume triggers.
    ```bash
    rm -f .devt/state/handoff.json .devt/state/continue-here.md
    ```

### Substep 2: Dispatch-envelope payload (from the bundle)

`$CTX.init` carries the `init workflow` compound payload — fill the dispatch-envelope placeholders from it (the wrapper already stamped `workflow_type=dev`; there is no separate activate call to paraphrase):

- **`inline_guardrails`** — `{ "<file>.md": "<content>" }` covering `golden-rules.md`, `engineering-principles.md`, `generative-debt-checklist.md` (or `null` when the 64 KB cap was hit → agents fall back to on-disk Reads). The `programmer` + `code-reviewer` dispatch templates embed it as a `<guardrails_inline>` block — inlining cuts three Read calls per dispatch in favor of cache-friendly prefix injection.
- **`governing_rules`** — `{ content, paths_included, paths_excluded, rules_hash, total_bytes }` covering the project's `.devt/rules/*.md` (96 KB cap; over-cap files in `paths_excluded` are Read on demand). `CLAUDE.md` is hashed but never inlined (harness-injected; `content["CLAUDE.md"]` is a stub, surfaced in `paths_excluded` as `harness_injected`). The `code-reviewer`, `verifier`, `researcher` dispatches embed it as `<governing_rules>`; `rules_hash` detects mid-workflow rule-file drift.
- **`models`** — fill the `{models.<agent>}` placeholders in Task() prompts.
- **`config`** — `model_profile`, `agent_skills` for dispatch behavior.

### Substep 3: Graphify eviction (done by the wrapper)

Stale Graphify artifacts were already evicted by the wrapper (`state evict-graphify`, run after the freshness read) — prevents a prior `/devt:review` or sibling workflow's `graph-impact.md` from persisting and misleading this session. Targeted: never touches `impl-summary.md` / `test-summary.md` that a resumed run legitimately depends on.

### Substep 4: Pre-Flight Brief (done by the wrapper)

The wrapper's `preflight generate "${TASK_DESCRIPTION}"` wrote `.devt/state/preflight-brief.md` (Lanes A-H + blast radius) so every subsequent agent reads the same governing rules (degrades silently on failure → agents fall back to `codebase-scan`). The PreToolUse `pre-flight-guard` hook warns or blocks edits whose target file isn't covered by a scratchpad PREFLIGHT line.

### Substep 5: memory_signal (cached by the wrapper)

The wrapper ran the `memory query "${TASK_DESCRIPTION}" --signal=3 --json-compact` aggregate once and cached it in `workflow.yaml::memory_signal_json` — consumed by the programmer, code-reviewer, and verifier dispatches (read back via `state read | jq -r '.memory_signal_json // "{}"'` into each `<memory_signal>` block). Also in the bundle as `$CTX.memory_signal`; no separate query round-trip.

### Substep 6: scope_hint + scope_trust (cached by the wrapper)

The wrapper ran `preflight scope-cache` (reads `preflight-brief.json`, computes `scope_hint` + `scope_trust`, applies the mechanical staleness override — forces `trust='sparse'` + writes `staleness-suppressed.txt` when state=ready AND lag exceeds `graphify.stale_threshold` or is null — and persists both to `workflow.yaml`). `scope_hint.suggested_reading` is the capped union of governing docs' `affects_paths` plus blast-radius `direct_dependents`. Both are in the bundle (`$CTX.scope_trust`) and read back into the `<scope_hint>` / `<scope_trust>` dispatch blocks; empty renders as `[]` and agents fall back to discovering scope from the task.

### Substep 7: Staleness gate + flag writes

**Staleness gate (tiered).** The wrapper tiered Graphify freshness into `$CTX.staleness_tier`. When `staleness_tier ∈ {stale, unknown_lag}` (lag ≥ `graphify.stale_threshold`, OR `graph_stats.state` is `ready` AND `staleness.lag_commits` is `null`), prompt via AskUserQuestion BEFORE any dispatch in this workflow:

- Question: "Graphify graph is {lag_commits ?? 'unknown'} commits behind HEAD; scope_hint signals may reflect stale call graph. Refresh now?"
- Options: **Refresh (recommended)** — pause, ask the user to run `graphify update .` in another terminal, then re-run `preflight generate "${TASK_DESCRIPTION}"` and re-cache; **Proceed with stale graph** — continue dispatch; agents see `scope_trust.fresh=false` and de-weight `scope_hint`; **Cancel** — STOP with BLOCKED.

When `workflow.yaml::autonomous=true`, skip the prompt and force `scope_trust.trust="sparse"`. Skip the gate entirely only when graphify is disabled (`scope_trust.trust == "empty"`) — a null `lag_commits` while `state=ready` (unreachable SHA, shallow clone) now triggers the prompt instead of silently disabling the gate.

**Flag writes** (parsed from the original task input, outside the wrapper). `${TASK_DESCRIPTION}` is the user's input stripped of `--autonomous`, `--to <phase>`, `--only <phase>`, `--chain`, `--tdd`, `--dry-run`:

- `--autonomous` → `node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update autonomous=true`
- `--to <phase>` → `state update stop_at_phase=<phase>`
- `--only <phase>` → `state update only_phase=<phase>`
- `--chain` → `state update autonomous_chain=next`
- `--tdd` → `state update tdd_mode=true`

**Parse `$CTX.init`:**

- If `$CTX.init.workflow_lock.locked` is true: STOP. Report: "A workflow is already active. Run /devt:workflow --cancel first."
- If `$CTX.init.dev_rules.missing_rules` is non-empty: WARN which required files are missing.
- If `$CTX.init.warnings` is non-empty: report each warning.
- Store `$CTX.init.models` for agent dispatch; `$CTX.init.config` for workflow behavior (model_profile, agent_skills).

### Substep 8: Graphify scan-prep + decision-artifact assertion

**Graphify scan-prep gate** — When the task is non-trivial AND the graph is dense AND blast radius is substantial, instruct the orchestrator to write a fresh `.devt/state/graph-impact.md` via two MCP calls. Field-validated threshold: `direct_dependents_count >= 10 AND graph_stats.trust == "dense"`. Below the threshold (or graphify disabled): skip; agents fall back to grep + scope_hint. The decision tree is bash; the MCP calls are the orchestrator's responsibility:

```bash
# `preflight scan-prep` consolidates the decision tree (reads
# preflight-brief.json's direct_dependents_count + graph_stats.trust +
# topic.symbols, applies the adaptive threshold, picks the central symbol) into
# one call and writes graphify-skip-reason.txt on SKIP — replacing the inline
# bash that was duplicated in quick-implement.md::graphify_scan_prep. Returns
# {decision, central_symbol, dependents, trust, threshold, symbols_count, reason}.
SCAN=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" preflight scan-prep --scope="${TASK_DESCRIPTION}")
DECISION=$(printf '%s\n' "$SCAN" | jq -r '.decision')
CENTRAL_SYMBOL=$(printf '%s\n' "$SCAN" | jq -r '.central_symbol // empty')
echo "graphify_scan_prep: $DECISION — $(printf '%s\n' "$SCAN" | jq -r '.reason // ("central=" + (.central_symbol // "?") + " dependents=" + (.dependents|tostring) + " trust=" + .trust)')"
```

The CLI emits exactly one of `graphify_scan_prep: ACTIVE` / `graphify_scan_prep: RECOVERY` / `graphify_scan_prep: SKIP` (also in `$DECISION`). Act on it:

**`graphify_scan_prep: ACTIVE`** — `$CENTRAL_SYMBOL` resolved. Execute these two MCP calls and concatenate the output into `.devt/state/graph-impact.md`:

1. **`mcp__plugin_devt_devt-graphify__blast_radius({symbols: ["<CENTRAL_SYMBOL>"]})`** — first call, returns the impact map with `direct_dependents` array.
2. **Drill-down on top-3 direct dependents** (multi-tier follow-up). Parse the `direct_dependents` array from blast_radius response, select the top 3 by `impact_size` (or first 3 if no rank), and for each call `mcp__plugin_devt_devt-graphify__get_neighbors({symbol: "<DEPENDENT_NAME>", direction: "in", depth: 2})`. This drills DOWN the impact tree — surfaces which callers will be affected if each high-risk dependent breaks. Why: one blast_radius call alone leaves lane subagents grep-hunting for caller sets that 3 cheap MCP calls would have surfaced.

Format `graph-impact.md` with sections `# Graph Impact — <task>` / `## Blast radius — <CENTRAL_SYMBOL>` / `## Drill-down: <dep1> [call: <correlation_id>]` / `## Drill-down: <dep2> [call: <correlation_id>]` / `## Drill-down: <dep3> [call: <correlation_id>]`. The `correlation_id` is the `_meta.correlation_id` field returned by each `get_neighbors` MCP response (8-char hex); omit the `[call: ...]` suffix when the field is absent so downstream lane reviewers can cite specific calls via `mcp-stats --correlation-id=<id>`. The subsequent scan / architect / implement steps will Read this file. When fewer than 3 direct_dependents are returned (small graph or leaf central symbol), drill into all available — the section may have 0-3 drill-downs.

**`graphify_scan_prep: SKIP`** — the CLI already wrote `graphify-skip-reason.txt` as the explicit decision artifact and no MCP call is made — downstream agents fall back to grep + scope_hint.

**`graphify_scan_prep: RECOVERY`** — topic extraction returned 0 symbols on a dense graph (the snake_case fallback also missed). Orchestrator MUST first call `mcp__plugin_devt_devt-graphify__query_graph({text: "${TASK_DESCRIPTION}", limit: 5})` — the `query_graph(task_text)` fallback — to resolve synthetic symbols against the graph, then proceed with `get_neighbors` + `blast_radius` using the top result's label as `CENTRAL_SYMBOL`. Write `graph-impact.md` with an additional `## Fuzzy symbol resolution` section listing the query and top results so the audit trail is explicit about how CENTRAL_SYMBOL was derived. The assert-graphify-decision gate below still requires either graph-impact.md or graphify-skip-reason.txt — recovery succeeds by producing the former.

**Decision artifact assertion** — hard-fail if the orchestrator skipped writing either artifact:

```bash
PFRESH=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-preflight-fresh)
if [ "$(printf '%s\n' "$PFRESH" | jq -r '.ok')" != "true" ]; then
  echo "BLOCKED: preflight-brief is stale — $(printf '%s\n' "$PFRESH" | jq -r '.reason')"
  exit 1
fi
ASSERT=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-graphify-decision)
if [ "$(printf '%s\n' "$ASSERT" | jq -r '.ok')" != "true" ]; then
  echo "BLOCKED: graphify decision artifact missing — $(printf '%s\n' "$ASSERT" | jq -r '.reason')"
  exit 1
fi
```

The assert auto-passes when graphify is disabled or the graph is missing (`graphify_state != "ready"`).

**Gate**: If compound init fails, STOP with BLOCKED — the project is not configured. If `state assert-graphify-decision` returns `ok:false`, STOP with BLOCKED — the orchestrator skipped the scan-prep decision step.
</step>

---

## Step 0.5: Flow Deviation Detection

<step name="flow_deviation" gate="workflow scope is confirmed">

Before assessing complexity, check if the task description implies skipping phases:

**Detection signals:**
- Words like "just", "only", "quick" → user may want partial workflow
- "implement" without mentioning tests → testing might be skipped accidentally
- "fix this" without mentioning review → review might be skipped
- Explicit phase requests: "validate and implement" → no testing or review mentioned

**If deviation detected:**

Ask via AskUserQuestion (even in `--autonomous` mode — scope decisions always need confirmation):

```yaml
question: "Your request implies a partial workflow. Which do you prefer?"
header: "Workflow Scope"
multiSelect: false
options:
  - label: "Full workflow (Recommended)"
    description: "implement → test → review → verify → docs — ensures quality and catches issues early"
  - label: "Partial workflow — as requested"
    description: "{describe which phases would run based on the user's wording}"
```

If user chooses full workflow: proceed normally.
If user chooses partial: record the skipped phases in workflow state and respect them throughout:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=flow_deviation skipped_phases="$SKIPPED_LIST"
```

**If no deviation detected:** proceed silently.

**Never skip phases silently.** If the user says "just implement this", that's a signal to ASK — not to skip tests and review without saying anything.
</step>

---

## Step 1: Complexity Assessment

<step name="assess" gate="complexity tier is determined: TRIVIAL, SIMPLE, STANDARD, or COMPLEX">

Use the complexity-assessment skill to evaluate the task:

Read `${CLAUDE_PLUGIN_ROOT}/skills/complexity-assessment/` for the assessment rubric.

Evaluate the task against these dimensions:

- **Scope**: How many files/modules will be touched?
- **Risk**: Does it touch critical paths, data models, or cross-service boundaries?
- **Novelty**: Is this a well-trodden pattern or something new?
- **Dependencies**: Are there cross-cutting concerns (auth, audit, events)?

### Quick Classification Heuristic

```
TRIVIAL if:   <=3 files AND no new patterns AND no cross-module deps AND no API changes AND no schema changes
SIMPLE if:    <=2 files AND 1 service AND 0 integrations AND no infra changes
COMPLEX if:   10+ files OR 3+ services OR 2+ integrations OR infra changes OR new patterns needed
STANDARD:     Everything else
```

### Tier → Steps Mapping

| Tier         | Criteria                                                            | Steps                                                                                       |
| ------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **TRIVIAL**  | Typo fix, config change, <=3 files, no decisions needed             | execute inline, validate quality gates (no subagents)                                       |
| **SIMPLE**   | Single file/function, well-known pattern, no cross-cutting concerns | implement, test, review, harvest (4 steps)                                                  |
| **STANDARD** | Multiple files, follows existing patterns, minor cross-cutting      | risk_warning, scan, regression_baseline, implement, test, simplify, review, verify, docs, retro, harvest, autoskill (12 steps) |
| **COMPLEX**  | New patterns, cross-service, architectural decisions needed         | risk_warning, research, plan, scan, regression_baseline, [arch-health?], architect, implement, test, simplify, review, verify, docs, retro, harvest, curate, autoskill (16-17 steps) |

Record the tier:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=assess status=IN_PROGRESS tier=$TIER
```

Report the tier and reasoning to the user before proceeding. The user can override the tier.

**Dry-run exit**: If `--dry-run` was detected, display the planned pipeline, reset state, and STOP:

```
--- DRY RUN ---
Task: {task_description}
Tier: {TIER}
Pipeline: {list of steps for this tier from the Tier→Steps table}
Agents: {list of agents that would be dispatched, with their model assignments from init JSON}
Estimated phases: {count}
---
No agents dispatched. Remove --dry-run to execute.
```

Reset the workflow state so it is not left in a locked state:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state reset
```

Do NOT proceed to any subsequent step. The dry run is complete.
</step>

## Step 1.5: Load Tier Steps

<step name="load_tier_steps" gate="tier-step file(s) for the assessed tier are loaded into context">
Based on the tier set in Step 1 (`workflow.yaml::tier`):

- **TRIVIAL / SIMPLE** — no tier-step file; the spine (implement → test → review) is the full pipeline.
- **STANDARD** — **Mandatory action: Read `${CLAUDE_PLUGIN_ROOT}/workflows/dev-workflow.standard.md` now**, so every STANDARD+ tier step body is in context before you reach its `TIER-STEP` insertion point below.
- **COMPLEX** — **Mandatory action: Read BOTH `${CLAUDE_PLUGIN_ROOT}/workflows/dev-workflow.standard.md` AND `${CLAUDE_PLUGIN_ROOT}/workflows/dev-workflow.complex.md` now** — the COMPLEX-only steps (auto_research_plan, architect, curate) live in the `.complex.md` file.

Do NOT execute any `TIER-STEP` insertion point or dispatch any agent for a STANDARD+ step until the tier file(s) for this tier are loaded.
</step>

---

### TRIVIAL Path (inline execution, no subagents)

<step name="trivial_path" gate="changes are made and quality gates pass">

_Only applies if complexity tier is TRIVIAL._

Execute the task directly in the main session. No subagents. No `.devt/state/` artifacts.

1. Read `.devt/rules/coding-standards.md` and `.devt/rules/quality-gates.md`
2. Make the change directly
3. Run quality gates
4. If gates fail: fix and retry (max 3 attempts). If still failing, upgrade to SIMPLE tier.
5. Report: files changed, gates passed. Done.

STOP here — do not proceed to subsequent steps.
</step>

---

### Risk & Simplicity Warning (STANDARD + COMPLEX)

<!-- TIER-STEP:risk_warning — step body relocated to workflows/dev-workflow.standard.md (loaded by the load_tier_steps step after Step 1). When tier is STANDARD or COMPLEX, execute the `risk_warning` step from that file at THIS pipeline position (after assess, before auto_research_plan (COMPLEX)). Skip for TRIVIAL/SIMPLE. -->

---

### Auto-Research & Auto-Plan (COMPLEX only)

<!-- TIER-STEP:auto_research_plan — step body relocated to workflows/dev-workflow.complex.md (loaded by the load_tier_steps step after Step 1). Execute the `auto_research_plan` step from that file at THIS pipeline position (after risk_warning, before scan) when the tier matches (COMPLEX only). -->

---

### Optional: Clarify Assumptions

For STANDARD and COMPLEX tasks, consider running the clarify-task workflow first:

- Read `${CLAUDE_PLUGIN_ROOT}/workflows/clarify-task.md`
- Identify gray areas in the task
- Present choices to user, capture decisions in `.devt/state/decisions.md`
- The programmer agent will read this decisions document as additional context

This step is recommended but not mandatory. Skip for well-defined tasks with clear requirements.

---

## Step 2: Codebase Scan (STANDARD + COMPLEX)

<!-- parallel-bash: scan + regression_baseline (Step 2.5) are independent
     (scan is read-only Grep/Read; regression_baseline runs project test/lint/
     typecheck commands and writes a distinct artifact). When regression_baseline
     would run a slow test suite, kick its bash off first with
     run_in_background=true, then immediately do this scan in the foreground.
     Await background completion before Step 3 (implement). See Step 2.5 for the
     pairing note. -->

<!-- TIER-STEP:scan — step body relocated to workflows/dev-workflow.standard.md (loaded by the load_tier_steps step after Step 1). When tier is STANDARD or COMPLEX, execute the `scan` step from that file at THIS pipeline position (pre-implement). Skip for TRIVIAL/SIMPLE. -->

---

## Step 2.5: Regression Baseline (STANDARD + COMPLEX)

<!-- TIER-STEP:regression_baseline — step body relocated to workflows/dev-workflow.standard.md (loaded by the load_tier_steps step after Step 1). When tier is STANDARD or COMPLEX, execute the `regression_baseline` step from that file at THIS pipeline position (pre-implement (after scan)). Skip for TRIVIAL/SIMPLE. -->

---

## Step 3: Architecture Review (COMPLEX only)

<!-- TIER-STEP:architect — step body relocated to workflows/dev-workflow.complex.md (loaded by the load_tier_steps step after Step 1). Execute the `architect` step from that file at THIS pipeline position (pre-implement (after scan/baseline)) when the tier matches (COMPLEX only). -->

---

## Step 4: Implementation

<step name="implement" gate="impl-summary.json is written with status DONE or DONE_WITH_CONCERNS">

**TDD Mode Check**: If `tdd_mode=true` in workflow state, SKIP this step for now — proceed directly to Step 5 (Testing) first. The tester will write failing tests based on the spec/task. After Step 5 completes, return here to implement code that makes the tests pass.

**Acceptance Criteria Gate**:

_Skip this gate if tier is TRIVIAL or SIMPLE._

Before dispatching the programmer, verify that acceptance criteria exist:

1. Check if `.devt/state/spec.md` exists AND contains a section matching `## Acceptance Criteria` or `## Success Criteria`
2. If YES: proceed — spec provides clear acceptance criteria for the verifier.
3. If NO: present options via AskUserQuestion (even in autonomous mode — scope clarity is not skippable):

```yaml
question: "No acceptance criteria found. The verifier needs criteria to validate against."
header: "Acceptance Criteria Missing"
multiSelect: false
options:
  - label: "Define criteria now (Recommended)"
    description: "I'll create a brief spec.md with acceptance criteria before coding starts"
  - label: "Derive from task description"
    description: "Auto-extract criteria from the task text — less precise but faster"
  - label: "Skip verification"
    description: "Proceed without criteria — verification step will be skipped"
```

- If **"Define criteria now"**: Pause. Create `.devt/state/spec.md` with a template containing acceptance criteria derived from the task. Present to user for review/edit. Resume after user confirms.
- If **"Derive from task description"**: Extract 3-5 verifiable criteria from the task description. Write to `.devt/state/spec.md`. Note in state: `acceptance_criteria_source=derived`.
- If **"Skip verification"**: Store `skipped_phases` to include `verify`. Note: this means the verifier will not run.

Initialize iteration tracking:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=implement status=IN_PROGRESS iteration=1
```

**Context loading by tier**: To manage context window usage, only load state artifacts relevant to the current tier:
- **SIMPLE**: `spec.md` (if exists), `review.md` (if fix iteration). Skip `scan-results.md`, `arch-review.md`, `research.md`, `decisions.md`.
- **STANDARD**: Add `scan-results.md`, `plan.md`, `decisions.md`. Skip `arch-review.md`, `research.md`.
- **COMPLEX**: Load all artifacts (current behavior).

When building the programmer's prompt, omit the `<arch_review>` and `<research>` XML elements entirely for SIMPLE/STANDARD — don't include them with "skip" instructions, as that wastes tokens on instructions about what NOT to read.

**Autonomous worktree isolation**: when `workflow.yaml.autonomous_chain` is non-null (i.e. this dispatch is part of an autonomous chain), pass `isolation: "worktree"` to the Task tool so the programmer's edits land in a temporary git worktree. Claude Code auto-cleans the worktree if the agent makes no changes; on success the diff is presented to the user before merge. Prevents an autonomous fix loop from clobbering an unrelated in-flight checkout. For interactive (non-autonomous) invocations, omit `isolation` — direct edits to the user's checkout are the expected behavior.

**Orchestrator-prep — read cached signals**. Both `memory_signal_json` and `scope_hint_json` were computed once at context_init and cached in `workflow.yaml`. Read them back so the agent's initial scan can use pre-resolved data instead of per-doc round trips:

```bash
# Re-derive scope_trust from current preflight-brief.json so the cached value reflects current graph state, not the value computed at workflow start. Fail-open: stale cache used if no brief.
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state refresh-scope-context >/dev/null 2>&1 || true
STATE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state read)
MEMORY_SIGNAL=$(printf '%s\n' "$STATE" | jq -r '.memory_signal_json // "{}"')
SCOPE_HINT=$(printf '%s\n' "$STATE" | jq -r '.scope_hint_json // "[]"')
SCOPE_TRUST=$(printf '%s\n' "$STATE" | jq -r '.scope_trust_json // "{}"')
```

Substitute `MEMORY_SIGNAL` into `<memory_signal>` and `SCOPE_HINT` into `<scope_hint>` below. Both blocks are byte-stable across retry iterations within a workflow run, so the cache hits across dispatches.

**Reuse pre-search** — derive graphify-powered candidates before the programmer writes new code. Best-effort: swallowed on graphify unavailability (0 candidates, gate passes transparently).

```bash
# KEEP IN SYNC: mirrored in quick-implement.md implement step
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
  REUSE_COUNT=$(printf '%s\n' "$REUSE_RESULT" | jq -r '.candidates_total // 0')
  echo "reuse-search: ${REUSE_COUNT} candidates → .devt/state/reuse-candidates.md"
fi
```

Dispatch the programmer agent:

```
<!-- BEGIN dispatch:programmer:dev -->
<!-- EDIT-SOURCE: templates/dispatch/envelopes/programmer.tmpl.md -->
Task(subagent_type="devt:programmer", model="{models.programmer}", prompt="
  <context>
    <files_to_read>.devt/rules/coding-standards.md, .devt/rules/quality-gates.md, .devt/rules/architecture.md</files_to_read>
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
    <spec>Read .devt/state/spec.md (if it exists — from /devt:specify). This is the primary requirements source with user stories, API design, and detailed acceptance criteria.</spec>
<memory_signal>{memory_signal_json}</memory_signal>
<scope_hint>{scope_hint_json}</scope_hint>
    <scope_trust>{scope_trust_json}</scope_trust>
    <graph_impact>
{graph_impact_content}
</graph_impact>
    <graph_impact_note>The above is orchestrator-mediated MCP output inlined from .devt/state/graph-impact.md. Your tool surface does not include `mcp__*graphify*`, so consume the inlined data rather than issuing graph queries. When the inlined content is a "(no graph-impact.md available — ...)" notice, fall back to grep-based investigation.</graph_impact_note>
    <!-- STANDARD+: include scan_results and plan -->
<reuse_candidates>Read .devt/state/reuse-candidates.md if present — graphify-derived list of existing functions with similar responsibility. Address each candidate in .devt/state/reuse-analysis.md before writing new code (see programmer.md::reuse_analysis step).</reuse_candidates>
    <scan_results>Read .devt/state/scan-results.md for existing patterns and code to reuse.</scan_results>
    <plan>Read .devt/state/plan.md (if it exists — from /devt:plan)</plan>
    <decisions>Read .devt/state/decisions.md (if it exists — from /devt:workflow --mode=clarify)</decisions>
    <!-- COMPLEX only: include arch_review and research -->
    <arch_review>Read .devt/state/arch-review.md (if it exists)</arch_review>
    <research>Read .devt/state/research.md (if it exists — from /devt:research)</research>
    <review_feedback>
      If this is a fix iteration, read feedback from whichever upstream gate failed:
      - Code-review retry: read `.devt/state/review.md` (full quality findings)
      - Verifier retry: read `.devt/state/verification.json` and address each entry in `revisions[]` by AC id. The structured `revisions[]` list IS the contract — each entry contains `id`, `criterion`, `gap`, and `evidence`. Address the gap directly; do not re-parse `verification.md`. The verifier rubric (`references/rubrics/dev.v1.md`) defines the verdict semantics.
      - Both: address review findings first, then verification gaps.
    </review_feedback>
    <scope_requirements>
      Extract every discrete requirement from the best available source (spec.md, plan.md, or task description) and list them numbered:
      R1: {requirement}
      R2: {requirement}
      ...
      The verifier will cross-reference this list against impl-summary.md to detect scope reduction. Every numbered requirement must have corresponding implementation evidence.
    </scope_requirements>
    <learning_context>{learning_context from context_init — relevant lessons from .devt/memory/lessons/ via Pre-Flight Brief, if any}</learning_context>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
  </context>
  <task>{task_description}

  **Capture knowledge candidates** (load-bearing — not optional, do this BEFORE writing impl-summary.md): per your `knowledge_candidates` step, if implementation surfaces non-obvious patterns worth promoting (hidden constraint discovered mid-flight, "must always do X" verified empirically, existing invariant that took grep-archaeology to find), append `#KNOWLEDGE-CANDIDATE: [type=decision|concept|flow|rejected] <one-line summary>` lines to `.devt/state/scratchpad.md`. Each tag passes: specificity, durability, non-obviousness, evidence, actionability.
  </task>
  Write summary to .devt/state/impl-summary.md
")
<!-- END dispatch:programmer:dev -->
```

**Claim-check (Q11)**: Before reading the sidecar, mechanically verify the programmer wrote its declared output. Catches the case where the programmer returned a verbal summary (mid-task wall) without actually writing impl-summary.md.

```bash
ARTIFACT_CHECK=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-artifact-present programmer)
if [ "$(printf '%s\n' "$ARTIFACT_CHECK" | jq -r '.ok')" != "true" ]; then
  echo "[BLOCKED] devt: $(printf '%s\n' "$ARTIFACT_CHECK" | jq -r '.reason')"
fi
# Rate-limit-mid-section recovery diagnostic. The PARTIAL contract triggers
# at section boundaries; a rate-limit mid-section leaves impl-summary.md at
# its stub-first sentinel with no structured sidecar. recover-partial-impl
# reads dispatch-warnings.jsonl::task_output_bytes + on-disk impl-summary
# substance and returns a recovery decision the orchestrator routes on.
PARTIAL_CHECK=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state recover-partial-impl programmer 2>/dev/null || echo '{}')
if [ "$(printf '%s\n' "$PARTIAL_CHECK" | jq -r '.recovery_needed // false')" = "true" ]; then
  SUGGESTED=$(printf '%s\n' "$PARTIAL_CHECK" | jq -r '.suggested_action // ""')
  if [ "$SUGGESTED" = "targeted-fix" ]; then
    MODE=$(printf '%s\n' "$PARTIAL_CHECK" | jq -r '.mode // ""')
    MISSING=$(printf '%s\n' "$PARTIAL_CHECK" | jq -r '.drift.missing_sections // [] | join(", ")')
    echo "[STRUCTURAL_DRIFT_DETECTED] mode=${MODE}"
    echo "[STRUCTURAL_DRIFT_DETECTED] missing_sections=${MISSING}"
    echo "[STRUCTURAL_DRIFT_DETECTED] $(printf '%s\n' "$PARTIAL_CHECK" | jq -r '.reason // ""')"
  else
    echo "[PARTIAL_IMPL_RECOVERY] suggested_action=${SUGGESTED}"
    echo "[PARTIAL_IMPL_RECOVERY] $(printf '%s\n' "$PARTIAL_CHECK" | jq -r '.reason // ""')"
  fi
fi
```

If the claim-check BLOCKED: programmer did not write impl-summary.md. Re-dispatch with explicit instruction, OR SendMessage-resume the same programmer with `<continue_from_section>` if a budget wall is suspected (often paired with `near_cliff` or `low_output` or `mid_task_language` records in `.devt/state/dispatch-warnings.jsonl`).

If `[PARTIAL_IMPL_RECOVERY]` surfaced with `suggested_action=SendMessage-resume`: the programmer was rate-limited mid-section (stub-only output + `low_output:true` signal). SendMessage the agent ID from the most recent programmer dispatch rather than re-dispatching from scratch — the stub-first sentinel + the orchestrator's section progress are recoverable context. If `suggested_action=investigate`: stub-only output without a rate-limit signal — investigate the dispatch transcript before re-dispatching.

If `[STRUCTURAL_DRIFT_DETECTED]` surfaced: programmer wrote a substantive impl-summary.md but dropped one or more sections that `agents/io-contracts.yaml::programmer.outputs.expected_sections` declares as required. Read `templates/dispatch/envelopes/programmer-fix.tmpl.md`, substitute `{drift_errors}` with the `missing_sections` list (one per line), and SendMessage-resume the existing programmer agent ID with the rendered fix prompt — NOT a fresh `Task()` dispatch. SendMessage-resume preserves the programmer's prior context (recent file edits, decisions made, gates run) so the fix can populate the dropped sections from real source material rather than inventing content. On `mode=warn`, the fix is advisory — proceed past the drift if the next gate requires it. On `mode=block`, the fix is mandatory before advancing to the test phase.

**Gate check**: Read the structured sidecar `.devt/state/impl-summary.json` for routing — the JSON is authoritative for control flow per the sidecar-only contract (the markdown carries no `## Status` header by design):

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state read-sidecar impl-summary.json
```

The sidecar exposes `status` (`DONE|DONE_WITH_CONCERNS|PARTIAL|BLOCKED|NEEDS_CONTEXT`), `verdict` (`PASS|FAIL|INDETERMINATE`), `requirements_covered[]`, `requirements_missing[]`, and `next_section` (when status=PARTIAL). Route on `status`:

- DONE or DONE_WITH_CONCERNS: proceed to test
- PARTIAL: programmer signaled mid-task wall. SendMessage-resume the programmer with `<continue_from_section>` set to `sidecar.next_section`. Do NOT advance to test.
- BLOCKED: surface the issue to the user and STOP
- NEEDS_CONTEXT: ask the user for clarification, then re-dispatch

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=implement status=$STATUS
```

**Post-implementation graphify refresh** — When `graphify.enabled=true` AND the implementation phase wrote new code (`impl-summary.json::files_modified` non-empty), the graph is now N commits behind reality for the rest of this workflow. Branch on `config.graphify.auto_refresh_post_impl` (default `"ask"`):

- **`"ask"` (default)** AND interactive (non-autonomous) mode: emit AskUserQuestion with header "Graphify refresh", question "Code changes landed. The graph is now N commits behind reality. Refresh now?", three options:
    1. **Refresh now (recommended)** — runs `node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" graphify maybe-refresh --force --timeout=60`, surfaces one-line confirmation. Downstream review/verify/docs phases see the new symbols.
    2. **Skip — I'll refresh manually later** — emits the `💡` tip and continues; user retains control. Next preflight will catch staleness via the staleness gate.
    3. **Always auto-refresh for this project** — runs the refresh AND writes `auto_refresh_post_impl: true` into `.devt/config.json` so future workflows in this project skip the prompt.
- **`true`** OR autonomous mode: silently call `node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" graphify maybe-refresh --force --timeout=60`. Surface a one-line confirmation: `🔄 Refreshed graphify graph after impl (Xs)` or `⚠️ Graphify refresh skipped: <reason>`. Continue regardless — refresh is best-effort.
- **`false`**: emit only the one-line tip — `💡 Code changes made — run `graphify update .` (or `node bin/devt-tools.cjs graphify maybe-refresh --force`) to refresh the project graph. The staleness gate will catch drift on the next workflow.` No prompt, no refresh.

Skip the step entirely when graphify is disabled (`config.graphify.enabled=false`) — emit nothing. Skip when `files_modified` is empty (impl phase made no code changes, e.g. docs-only).

</step>

---

## Step 5: Testing

<step name="test" gate="test-summary.json is written with status DONE or DONE_WITH_CONCERNS">

**Reuse-analysis gate** — programmer must have addressed all reuse candidates before tests run.

```bash
# KEEP IN SYNC: mirrored in quick-implement.md test step
REUSE_GATE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-reuse-analyzed 2>/dev/null || echo '{"ok":true}')
if printf '%s\n' "$REUSE_GATE" | jq -e '.ok == false' >/dev/null 2>&1; then
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=implement status=BLOCKED verdict=FAILED
  echo "BLOCKED: $(printf '%s\n' "$REUSE_GATE" | jq -r '.reason')"
  exit 0
fi
```

_Skip this step if `test` is listed in `skipped_phases` from workflow state._

**TDD Mode**: If `tdd_mode=true` in workflow state AND this is the FIRST pass (no `impl-summary.md` exists yet):
- Change the tester's task prompt to: "Write failing tests that define the expected behavior for: {task_description}. Do NOT implement any production code. Tests should fail because the production code does not exist yet."
- Add to the tester's context: `<tdd_skill>Read ${CLAUDE_PLUGIN_ROOT}/skills/tdd-patterns/SKILL.md — follow the RED phase protocol.</tdd_skill>`
- After tester completes: return to Step 4 (Implementation). Add to the programmer's context:
  - `<failing_tests>Read .devt/state/test-summary.md — these are the RED tests you must make pass.</failing_tests>`
  - `<tdd_skill>Read ${CLAUDE_PLUGIN_ROOT}/skills/tdd-patterns/SKILL.md — follow the GREEN phase protocol. Write MINIMAL code to pass each test.</tdd_skill>`
- After programmer completes: proceed to Step 5 again for additional test coverage (edge cases, error paths). This second tester pass follows normal (non-TDD) behavior.

Dispatch the tester agent:

```
<!-- BEGIN dispatch:tester:dev -->
<!-- EDIT-SOURCE: templates/dispatch/envelopes/tester.tmpl.md -->
Task(subagent_type="devt:tester", model="{models.tester}", prompt="
  <context>
    <files_to_read>.devt/rules/testing-patterns.md, .devt/rules/quality-gates.md</files_to_read>
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
    <graphify_status>{graphify_status_json}</graphify_status>
    {prior_outputs}
    <impl_summary_sidecar>Read .devt/state/impl-summary.json — files_changed (authoritative file list), concerns[] (per-file context), next_agent_hints.focus_areas (test priorities), next_agent_hints.skip_areas (don't-test set). Compute coverage_complete by comparing your coverage_files to files_changed; false → re-dispatch with gap as review_feedback.</impl_summary_sidecar>
    <impl_summary>Read .devt/state/impl-summary.md ONLY when a concerns[] entry references prose context not captured by structured fields, OR when next_agent_hints.focus_areas is empty AND files_changed is non-empty (degraded sidecar — fall back to narrative).</impl_summary>
    <spec>Read .devt/state/spec.md (if exists — from /devt:specify). Use the "Test Scenarios" section as required coverage targets.</spec>
    <learning_context>{learning_context from context_init — relevant lessons from .devt/memory/lessons/ via Pre-Flight Brief, if any}</learning_context>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
  </context>
  <task>
    Write comprehensive tests for the implementation described in .devt/state/impl-summary.md.
    Cover happy paths, error paths, edge cases, and boundary conditions.
    If a spec exists, ensure every test scenario from the spec has a corresponding test.
  </task>
  Write summary to .devt/state/test-summary.md AND structured sidecar to .devt/state/test-summary.json (the JSON is authoritative for routing)
")
<!-- END dispatch:tester:dev -->
```

**Gate check**: Read the structured sidecar `.devt/state/test-summary.json` for routing — the JSON is authoritative for control flow per the sidecar-only contract:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state read-sidecar test-summary.json
```

The sidecar exposes `status` (`DONE|DONE_WITH_CONCERNS|BLOCKED|NEEDS_CONTEXT`), `verdict` (`PASS|FAIL|INDETERMINATE`), and `tests.{added,passed,failed,skipped}_count` fields. Route on `status`:

- DONE or DONE_WITH_CONCERNS: proceed to **simplify** (STANDARD/COMPLEX) or **review** (TRIVIAL/SIMPLE)
- BLOCKED: surface the issue to the user and STOP
- NEEDS_CONTEXT: ask the user for clarification, then re-dispatch

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=test status=$STATUS
```

</step>

---

## Step 5.5: Simplify (STANDARD + COMPLEX)

<!-- TIER-STEP:simplify — step body relocated to workflows/dev-workflow.standard.md (loaded by the load_tier_steps step after Step 1). When tier is STANDARD or COMPLEX, execute the `simplify` step from that file at THIS pipeline position (after test, before review). Skip for TRIVIAL/SIMPLE. -->

---

## Step 6: Code Review

<step name="review" gate="review.md is written with verdict APPROVED or APPROVED_WITH_NOTES">

_Skip this step if `review` is listed in `skipped_phases` from workflow state._

**Orchestrator-prep — read cached signals**. `memory_signal_json` and `scope_hint_json` were cached at context_init; re-read both here so the reviewer can spot REJ-tombstone matches, ADR violations, and the implementation's likely paths without per-doc round trips:

```bash
# Re-derive scope_trust from current preflight-brief.json so the cached value reflects current graph state, not the value computed at workflow start. Fail-open: stale cache used if no brief.
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state refresh-scope-context >/dev/null 2>&1 || true
STATE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state read)
MEMORY_SIGNAL=$(printf '%s\n' "$STATE" | jq -r '.memory_signal_json // "{}"')
SCOPE_HINT=$(printf '%s\n' "$STATE" | jq -r '.scope_hint_json // "[]"')
SCOPE_TRUST=$(printf '%s\n' "$STATE" | jq -r '.scope_trust_json // "{}"')
```

Substitute `MEMORY_SIGNAL` into `<memory_signal>` and `SCOPE_HINT` into `<scope_hint>` below.

Dispatch the code-reviewer agent:

```
<!-- BEGIN dispatch:code-reviewer:dev -->
<!-- EDIT-SOURCE: templates/dispatch/envelopes/code-reviewer.tmpl.md -->
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
<guardrails_inline>
      <golden_rules>{inline_guardrails["golden-rules.md"]}</golden_rules>
      <engineering_principles>{inline_guardrails["engineering-principles.md"]}</engineering_principles>
      <generative_debt_checklist>{inline_guardrails["generative-debt-checklist.md"]}</generative_debt_checklist>
    </guardrails_inline>
    <graph_impact>
{graph_impact_content}
</graph_impact>
    <graph_impact_note>The above is orchestrator-mediated MCP output inlined from .devt/state/graph-impact.md — high-signal review map: code in affected_communities deserves deeper inspection than code outside the radius. Your tool surface does not include `mcp__*graphify*`, so consume the inlined data rather than issuing graph queries.</graph_impact_note>
    {prior_outputs}
    {provenance_protocol}
    <impl_summary>Read .devt/state/impl-summary.md</impl_summary>
    <test_summary>Read .devt/state/test-summary.md</test_summary>
    <decisions>Read .devt/state/decisions.md (if exists — from /devt:workflow --mode=clarify)</decisions>
    <learning_context>{learning_context from context_init — relevant lessons from .devt/memory/lessons/ via Pre-Flight Brief, if any}</learning_context>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
  </context>
  <task>
    Review the implementation and tests for quality, correctness, and standards compliance.
    Review ALL code in scope — do not filter by origin or label findings as pre-existing.

    **Capture knowledge candidates** (load-bearing — not optional, do this BEFORE writing review.md): per your `knowledge_candidates` step, if this review surfaces non-obvious patterns worth promoting (recurring code smell, undocumented invariant, "we always do X because Y" rule, REJ-tombstone-worthy anti-pattern), append `#KNOWLEDGE-CANDIDATE: [type=decision|concept|flow|rejected] <one-line summary>` lines to `.devt/state/scratchpad.md`. Each tag passes: specificity, durability, non-obviousness, evidence, actionability.
  </task>
  Write review to .devt/state/review.md
")
<!-- END dispatch:code-reviewer:dev -->
```

**Gate check**: Read `.devt/state/review.md` and check verdict and score. Also read the current `iteration` value from workflow state (`node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state read` → `iteration` field) to determine which repair operator applies:

- **Score < 50 in autonomous mode**: pause and surface findings to the user even if autonomous — likely an architectural issue that automated retries won't resolve
- **APPROVED** or **APPROVED_WITH_NOTES**: proceed to next step
- **NEEDS_WORK** — apply the **repair operator** based on the current `iteration` value from state:
  - **Iteration 1–3 → RETRY**: go back to **Step 4 (implement)** with review feedback
    - Increment iteration: `node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=review iteration=$((ITER+1)) verdict=NEEDS_WORK repair=RETRY`
    - The programmer agent reads `.devt/state/review.md` as `<review_feedback>` and addresses all findings
  - **Iteration 4 → DECOMPOSE**: analyze unresolved findings from review.md
    - Classify each finding: is it fixable in isolation, or does it require cross-cutting changes?
    - Write cross-cutting findings to `.devt/state/scratchpad.md` under `## Deferred Review Findings` BEFORE re-dispatching programmer
    - Re-dispatch programmer with a **focused scope**: include only the fixable findings in `<review_feedback>`, not the full review.md. Prepend: "DECOMPOSE pass — fix ONLY the findings listed below. Cross-cutting issues have been deferred."
    - Increment iteration: `node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=review iteration=5 verdict=NEEDS_WORK repair=DECOMPOSE`
  - **Iteration 5 → PRUNE**: stop iterating
    - Collect all remaining unresolved findings from review.md
    - Write them to `.devt/state/scratchpad.md` under `## Deferred Review Findings`
    - Proceed with status DONE_WITH_CONCERNS (do not BLOCK)
    - Report: "Review iteration limit reached. N findings deferred to scratchpad. Proceeding with implementation."
    - `node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=review iteration=5 verdict=NEEDS_WORK repair=PRUNE`

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=review status=$STATUS verdict=$VERDICT
```

</step>

---

## Step 6.5: Verification (STANDARD + COMPLEX)

<!-- TIER-STEP:verify — step body relocated to workflows/dev-workflow.standard.md (loaded by the load_tier_steps step after Step 1). When tier is STANDARD or COMPLEX, execute the `verify` step from that file at THIS pipeline position (after review, before docs_retro). Skip for TRIVIAL/SIMPLE. -->

---

## Step 7+8: Documentation and Retrospective (parallel, STANDARD + COMPLEX)

<!-- TIER-STEP:docs_retro_parallel — step body relocated to workflows/dev-workflow.standard.md (loaded by the load_tier_steps step after Step 1). Execute the `docs_retro_parallel` step from that file at THIS pipeline position (after verify, before harvest_observations) when the tier matches (STANDARD or COMPLEX). -->

---

## Step 9a: Memory Harvest (UNCONDITIONAL — all complexity tiers)

<step name="harvest_observations" gate="memory suggest exits 0">

This step runs for ALL workflows regardless of complexity tier or retro/curator skip flags. It harvests `#KNOWLEDGE-CANDIDATE` scratchpad tags + `.devt/state/decisions.md` DEC-xxx entries + Graphify god-nodes (when graphify-out/GRAPH_REPORT.md exists) + claude-mem MCP observations (when persisted by the orchestrator pre-step below) into `.devt/memory/_suggestions.md`. Curator review of these proposals is gated separately (see Step 9b); the harvest itself is intentionally NOT skippable so observations from quick/simple workflows are buffered for the next curator pass.

**Orchestrator pre-step (claude-mem MCP) — DECISION-ARTIFACT REQUIRED.** Exactly ONE of `.devt/state/claude-mem-harvest.md` or `.devt/state/claude-mem-skipped.txt` MUST exist after this step. The `state assert-claude-mem-harvest` gate below enforces this — orchestrators that skip silently get caught.

If `mcp__plugin_claude-mem_mcp-search__search` is registered in this session:
1. Call `mcp__plugin_claude-mem_mcp-search__search` with `query=${task}`, `project=<current devt project name>`, and `limit=50`. The response is a markdown index with table-row observations (`| #NNNN | time | <emoji> | Title | ~tokens |`) grouped by source file.
2. For each observation row with emoji ⚖️ (decision) or 🔵 (discovery): fetch the body via `mcp__plugin_claude-mem_mcp-search__get_observations({ids: [...]})` — the bare `search` response carries only Title, not body, so without `get_observations` the curator's evidence filter rejects the candidate. Batch IDs into one `get_observations` call for efficiency.
3. Write `.devt/state/claude-mem-harvest.md` with one line each in canonical format:

   ```
   - [decision] <title>: <body>
   - [discovery] <title>: <body>
   ```

   Map emoji → obs_type: ⚖️ → `decision`, 🔵 → `discovery`. Drop rows with any other emoji (bugfix / feature / refactor / change — session telemetry, not memory candidates). The next `memory suggest` invocation picks up the file via `discovery.cjs::harvestClaudeMemFromMcp`.

If the MCP tool is unavailable, returns zero observations, or errors:
- Write `.devt/state/claude-mem-skipped.txt` with the structured payload below. The gate validates the `reason=` enum (`not_installed | mcp_unavailable | corpus_empty | task_unrelated_to_history`) — free-form one-liners are rejected. For `task_unrelated_to_history`, also include a `details=` line explaining the orchestrator's reasoning.

```bash
cat > .devt/state/claude-mem-skipped.txt <<EOF
reason=mcp_unavailable
attempted_at=$(date -u +%FT%TZ)
EOF
```

```bash
HARVEST=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-claude-mem-harvest)
if [ "$(printf '%s\n' "$HARVEST" | jq -r '.ok')" != "true" ]; then
  echo "BLOCKED: claude-mem decision artifact missing — $(printf '%s\n' "$HARVEST" | jq -r '.reason')"
  exit 1
fi
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" memory suggest >/dev/null 2>&1 || true
```

Harvest is cheap (~10ms — pure filesystem reads of scratchpad/decisions/graphify report/claude-mem harvest). It NEVER writes permanent memory docs — only a curator-reviewable proposal report.

The `|| true` is intentional: harvest is best-effort. A missing `.devt/memory/` directory or empty observation set produces a 0-issue report. We never fail a workflow because harvest had nothing to find.

</step>

---

## Step 9b: Curation (COMPLEX only)

<!-- TIER-STEP:curate — step body relocated to workflows/dev-workflow.complex.md (loaded by the load_tier_steps step after Step 1). Execute the `curate` step from that file at THIS pipeline position (after harvest_observations) when the tier matches (COMPLEX only). -->

---

## Step 10: Autoskill (STANDARD + COMPLEX)

<!-- TIER-STEP:autoskill — step body relocated to workflows/dev-workflow.standard.md (loaded by the load_tier_steps step after Step 1). When tier is STANDARD or COMPLEX, execute the `autoskill` step from that file at THIS pipeline position (after curate, before review_deferred). Skip for TRIVIAL/SIMPLE. -->

---

## Workflow Completion

<step name="review_deferred" gate="deferred findings are surfaced or scratchpad is empty">

## Review Deferred Findings

If `.devt/state/scratchpad.md` exists and is non-empty, surface deferred items to the user:

```bash
cat .devt/state/scratchpad.md 2>/dev/null || echo "NO_DEFERRED"
```

If scratchpad has content:
- List all deferred review findings and verification gaps
- For each item, indicate whether it is: **low-risk** (cosmetic, style) or **medium-risk** (logic, correctness)
- Ask the user: "N deferred items found. Address now, create follow-up task, or acknowledge and proceed?"
  - **Address now**: dispatch programmer for targeted fixes, then re-run quality gates
  - **Follow-up**: note items for a future task (user responsibility)
  - **Acknowledge**: proceed to finalization as-is

If no scratchpad or empty: skip this step silently.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=review_deferred status=IN_PROGRESS
```
</step>

<step name="finalize" gate="final status is reported to user">

**Knowledge-candidates-tagged gate.** Before completing, assert that the orchestrator either surfaced `#KNOWLEDGE-CANDIDATE` lines in `scratchpad.md` during work OR declared none via `knowledge-candidates-none.txt` with a structured reason. Why: candidates described in prose but never tagged never reach the curator harvester. Runs BEFORE the scratchpad truncate below.

**Layer-2 claim-check resolution gate.** Block finalize if any Layer-1 `assert-artifact-present` failures in this workflow window are still unresolved (agent dispatch returned without writing its declared output, not re-dispatched). Mirrors S1's post-hoc pattern. Set `claim_check_mode: "warn"` in config to opt out.

```bash
CC_GATE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-claim-checks-resolved)
if printf '%s\n' "$CC_GATE" | jq -e '.ok == false' >/dev/null 2>&1; then
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=finalize status=BLOCKED verdict=FAILED
  echo "BLOCKED: $(printf '%s\n' "$CC_GATE" | jq -r '.reason')"
  exit 0
fi
```

**Dispatch-hygiene post-hoc gate.** Block finalize if any raw devt:* dispatches happened this session (Claude Code doesn't enforce PreToolUse Task-deny). Set `dispatch_hygiene_mode: "warn"` in config to opt out.

```bash
RD_GATE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-no-raw-dispatches-this-session)
if printf '%s\n' "$RD_GATE" | jq -e '.ok == false' >/dev/null 2>&1; then
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=finalize status=BLOCKED verdict=FAILED
  echo "BLOCKED: $(printf '%s\n' "$RD_GATE" | jq -r '.reason')"
  exit 0
fi
```

Aggregate any tags the programmer placed inside `impl-summary*.md` (the aggregator scans those alongside `review-lane-*.md`/`review.md`) so they reach scratchpad before the gate inspects it.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state aggregate-knowledge-candidates >/dev/null 2>&1 || true
KC_GATE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-knowledge-candidates-tagged)
if printf '%s\n' "$KC_GATE" | jq -e '.ok == false' >/dev/null 2>&1; then
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=finalize status=BLOCKED verdict=FAILED
  echo "BLOCKED: $(printf '%s\n' "$KC_GATE" | jq -r '.reason')"
  exit 0
fi
```

When the gate trips: re-read impl-summary.md + review.md narratives, identify non-obvious patterns the agents described in prose but did not tag, append `#KNOWLEDGE-CANDIDATE: [type=...] <summary>` lines to scratchpad.md, then re-enter finalize. If genuinely none qualify, write the structured none-declaration: `printf 'reason=no_novel_patterns\ndeclared_at=%s\n' "$(date -u +%FT%TZ)" > .devt/state/knowledge-candidates-none.txt`.

Summarize the workflow results:

**Memory-candidate footer** (B-III.1.c).

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" memory candidates-footer
```

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state advance-phase complete active=false
```

**Clear ephemeral scratchpad.** The `scratchpad.md` PREFLIGHT lines and Deferred sections served their purpose: discovery harvested any `#KNOWLEDGE-CANDIDATE` tags (Step 9), `review_deferred` surfaced any deferred findings to the user (Step 11). Truncate now so the next workflow in this session starts clean and stale PREFLIGHT lines do not falsely satisfy the pre-flight-guard hook for unrelated files:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state truncate-artifact scratchpad.md
```

If `autonomous=true` in workflow state:
- After setting `active=false phase=complete`, also run:
  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update autonomous_chain=ship
  ```
- This tells `/devt:next` to auto-proceed to `/devt:ship` without prompting the user.

Report to the user:

- **Complexity tier**: SIMPLE / STANDARD / COMPLEX
- **Steps executed**: list of steps that ran
- **Implementation**: files modified/created (from impl-summary.md)
- **Tests**: pass/fail counts (from `test-summary.json::tests.{passed,failed}_count`)
- **Review verdict**: APPROVED / APPROVED_WITH_NOTES (from review.md)
- **Review score**: N/100
- **Verification**: VERIFIED / GAPS_FOUND / FAILED (from verification.md, if applicable)
- **Iterations**: how many implement-review-verify cycles occurred
- **Documentation**: what was updated (if applicable)
- **Lessons extracted**: count (if applicable)
- **Artifacts created**: list all .devt/state/ files with sizes
  ```bash
  ls -la .devt/state/*.md .devt/state/*.yaml .devt/state/*.json 2>/dev/null
  ```
- **Overall status**: DONE | DONE_WITH_CONCERNS | BLOCKED

If DONE_WITH_CONCERNS, list the concerns.
If BLOCKED, explain what is blocking and what user action is needed.
</step>

---

<model_selection_guidance>
When dispatching agents, match model capability to task complexity:

| Task Type                  | Signal                                          | Model                |
| -------------------------- | ----------------------------------------------- | -------------------- |
| Mechanical implementation  | Clear spec, 1-2 files, known pattern            | Budget model (fast)  |
| Integration work           | Multiple files, cross-module coordination       | Standard model       |
| Architecture/design review | System-wide judgment, trade-offs                | Best available model |
| Code review                | Quality decisions, pattern detection            | Best available model |
| Verification               | Goal tracing, wiring checks, outcome validation | Best available model |
| Documentation              | Straightforward updates                         | Budget model         |
| Lesson extraction          | Pattern recognition across artifacts            | Standard model       |

The `models` object from compound init provides the configured model per agent.
Override in .devt/config.json `model_overrides` for project-specific tuning.
</model_selection_guidance>

<deviation_rules>
Agents follow Rules 1-4 from the programmer agent's deviation framework (see `agents/programmer.md`):

1. **Rule 1 (Auto-fix): Bugs** — Logic errors, type errors, null references, security flaws. Agent fixes inline, no workflow iteration.
2. **Rule 2 (Auto-fix): Missing critical functionality** — Missing error handling, input validation, auth checks, rate limiting. Agent fixes inline.
3. **Rule 3 (Auto-fix): Blocking issues** — Missing dependency, broken imports, wrong types, build errors. Agent fixes inline.
4. **Rule 4 (STOP): Architectural changes** — New database table, major schema change, new service layer, switching libraries. Workflow STOPS and surfaces to user.

**Shared process for Rules 1-3**: Fix → add/update tests if applicable → verify fix → continue → track as `[Rule N - Type]` in summary.

**Attempt limit**: After 3 auto-fix attempts on a single issue within an agent, the agent reports DONE_WITH_CONCERNS. This does not count as a review iteration.

**Scope**: Only auto-fix issues directly caused by the current task. Pre-existing issues are logged to `.devt/state/scratchpad.md` under category `Deferred`.

**Failure recovery**: If a workflow phase is stuck in a fix loop or an agent repeatedly returns BLOCKED, consult `${CLAUDE_PLUGIN_ROOT}/docs/operator-guide/incident-runbook.md` for escalation procedures before giving up.
</deviation_rules>

<success_criteria>

- Implementation is complete (impl-summary.md status is DONE or DONE_WITH_CONCERNS)
- All tests pass (`test-summary.json::tests.failed_count = 0`)
- Code review is APPROVED or APPROVED_WITH_NOTES (score >= 80)
- Verification passed (verification.md status is VERIFIED) — if STANDARD or COMPLEX
- Documentation is updated (if STANDARD or COMPLEX)
- Lessons are extracted and curated (if applicable)
- Final status: **DONE** or **DONE_WITH_CONCERNS**
  </success_criteria>
