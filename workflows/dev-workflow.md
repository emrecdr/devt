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
- Risk & simplicity warning triggers (simpler approach detected)
- Max iteration limits exceeded

**Detection:** Check if the task description string contains `--autonomous`. Strip the flag before passing the task to agents. Store `autonomous: true` in workflow state.

**Output in autonomous mode:** Display a compact status line at each phase transition instead of asking for confirmation:
```
--- Phase 3/7: Testing --- tester: DONE (4 tests, all passing). Proceeding...
```
</autonomous_mode>

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
- `devt:curator` — playbook quality maintenance specialist (Read, Write, Edit, Bash, Glob, Grep)
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

If `agent_skills` is not configured or the key is missing for the agent type, consult `${CLAUDE_PLUGIN_ROOT}/skill-index.yaml` for the default agent→skill mapping and inject those defaults.
</agent_skill_injection>

<task_handoff>
## Structured Task Handoff

When dispatching agents via `Task()`, use the structured handoff format from `${CLAUDE_PLUGIN_ROOT}/templates/task-handoff-template.md`. Fill in fields from available `.devt/state/` artifacts:

- **Objective**: from task description + spec.md (if exists)
- **Acceptance criteria**: from spec.md or derived from task description
- **Prior artifacts**: summarize each existing .devt/state/ file (do NOT reference missing files)
- **Constraints**: from .devt/rules/ + CLAUDE.md + decisions.md
- **Test scenarios**: from spec.md (if exists) — include in tester dispatch only
- **Handoff notes**: from previous agent's output + concerns from workflow state

This ensures every agent receives consistent, complete context — no missing information, no free-form prompts that vary between dispatches.
</task_handoff>

---

## Context Loading

Before any step, initialize the workflow:

<step name="context_init" gate="compound init succeeds and .devt/rules/ is readable">

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" init workflow
```

This compound init:

1. Validates `.devt/config.json` exists and is valid
2. Creates/resets `.devt/state/` for a fresh workflow run
3. Records workflow start time and task description

Then load project context:

- Read `${CLAUDE_PLUGIN_ROOT}/protocols/status-enum.md` for status values and transition mapping
- Read `${CLAUDE_PLUGIN_ROOT}/protocols/checkpoint-protocol.md` for checkpoint format
- Read `.devt/rules/coding-standards.md`
- Read `.devt/rules/architecture.md`
- Read `.devt/rules/quality-gates.md`
- Read `.devt/rules/testing-patterns.md`
- Read `CLAUDE.md` if it exists
- Search for relevant lessons: if `.devt/learning-playbook.md` exists, query it for entries relevant to the task:
  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" semantic query "{task_keywords}"
  ```
  Parse the JSON output. If `count > 0`, format results as a readable `learning_context` string for agent dispatches. Each result has `description` and `evidence` fields — format as a bulleted list:
    ```
    Relevant lessons from past workflows:
    - Always check for existing error types before creating new ones (evidence: Created DuplicateEntryError when ConflictError already existed)
    - Run the full module test suite before marking implementation done (evidence: New code broke 3 existing tests)
    ```
  If `.devt/learning-playbook.md` does not exist or returns zero results, set `learning_context` to empty (agents proceed without prior lessons — this is normal for new projects).
- Read `.devt/state/spec.md` if it exists (from `/devt:specify`)
  - If spec exists: use it as the primary requirements source — decisions, API design, test scenarios
  - If no spec: derive requirements from the task description
- Read `.devt/state/plan.md` if it exists (from `/devt:plan`)
  - If plan exists: use it to guide implementation (programmer reads it as context)
  - If no plan: proceed normally (programmer plans internally)
- Read `.devt/state/research.md` if it exists (from /devt:research)
  - If research.md has status DONE_WITH_CONCERNS, flag concerns to planner/programmer as additional context
- Read `.devt/state/handoff.json` if it exists (from /devt:pause)
  - If handoff exists: restore phase, iteration, and remaining_tasks as resume context
  - Use handoff.next_action to guide which step to resume from
  - Compare handoff.last_commit with current `git rev-parse HEAD` — if they differ, warn user that codebase may have changed since pause
  - **Delete handoff.json after reading** — it is a one-shot artifact. Stale handoff data causes false resume triggers.
    ```bash
    rm -f .devt/state/handoff.json .devt/state/continue-here.md
    ```

Store the task description in workflow state for reference by status, forensics, and resume:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update active=true workflow_type=dev phase=context_init status=DONE stopped_at=null stopped_phase=null "task=${TASK_DESCRIPTION}"
```

If `--autonomous` was detected, also write: `node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update autonomous=true`

Where `${TASK_DESCRIPTION}` is the user's original task input (stripped of `--autonomous` flag if present).

Parse the init output JSON:

- If `workflow_lock.locked` is true: STOP. Report: "A workflow is already active. Run /devt:cancel-workflow first."
- If `dev_rules.missing_rules` is non-empty: WARN user which required files are missing
- If `warnings` array is non-empty: report each warning
- Store `models` for agent dispatch (use model values in Task() prompts)
- Store `config` for workflow behavior (model_profile, agent_skills)

**Gate**: If compound init fails, STOP with BLOCKED — the project is not configured.
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
| **SIMPLE**   | Single file/function, well-known pattern, no cross-cutting concerns | implement, test, review (3 steps)                                                           |
| **STANDARD** | Multiple files, follows existing patterns, minor cross-cutting      | scan, implement, test, simplify, review, verify, docs, retro, autoskill (9 steps)           |
| **COMPLEX**  | New patterns, cross-service, architectural decisions needed         | research, plan, scan, [arch-health?], architect, implement, test, simplify, review, verify, docs, retro, curate (12-13 steps) |

Record the tier:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=assess status=IN_PROGRESS tier=$TIER
```

Report the tier and reasoning to the user before proceeding. The user can override the tier.
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

<step name="risk_warning" gate="risk check completed">

_Skip if TRIVIAL or SIMPLE._

Before proceeding, evaluate:

1. **Simpler approach exists?** — Is the proposed solution more complex than the problem requires?
2. **Over-engineering risk?** — Does the task description imply abstractions or patterns beyond what's needed?
3. **High-risk change?** — Does it touch auth, data integrity, public APIs, or 10+ files?
4. **Breaking change?** — Does it change API contracts, database schema, or external interfaces?

If ANY warning triggers, present options to the user via AskUserQuestion:

```yaml
question: "I detected a potential concern before proceeding."
header: "Risk Check"
multiSelect: false
options:
  - label: "Proceed with current approach"
    description: "{describe the approach and its trade-offs}"
  - label: "Use simpler alternative (Recommended)"
    description: "{describe the simpler approach if one exists}"
  - label: "Let me reconsider the task"
    description: "Pause to rethink scope or approach"
```

If no warnings trigger, proceed silently.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=risk_warning status=DONE
```

</step>

---

### Auto-Research & Auto-Plan (COMPLEX only)

<step name="auto_research_plan" gate="research and plan exist for COMPLEX tasks">

_Only applies if complexity tier is COMPLEX._

**Auto-Research**: If no `.devt/state/research.md` exists, dispatch the researcher agent automatically:

```
Task(subagent_type="devt:researcher", model="{models.researcher}", prompt="
  <task>Research implementation approaches for: {task_description}</task>
  <context>
    <files_to_read>.devt/rules/coding-standards.md, .devt/rules/architecture.md</files_to_read>
    <spec>Read .devt/state/spec.md (if exists)</spec>
    <decisions>Read .devt/state/decisions.md (if exists)</decisions>
    <template>${CLAUDE_PLUGIN_ROOT}/templates/research-template.md</template>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
  </context>
  Write findings to .devt/state/research.md
")
```

If research.md already exists: skip, use existing findings.

**Auto-Plan**: If no `.devt/state/plan.md` exists, create one inline using the planning logic from `${CLAUDE_PLUGIN_ROOT}/workflows/create-plan.md` (Steps 3-5: analyze, plan, validate). Do NOT dispatch a separate subagent for planning — the main session creates the plan.

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

<step name="scan" gate="scan-results.md is written to .devt/state/">

_Skip this step if complexity is SIMPLE._

Use the codebase-scan skill to survey relevant code:

Read `${CLAUDE_PLUGIN_ROOT}/skills/codebase-scan/` for the scan protocol.

Scan for:

- Existing implementations related to the task (patterns to reuse)
- Module boundaries and interfaces involved
- Error types, constants, enums in the domain
- Existing tests for the affected modules
- Cross-module dependencies and integration points

Write results to `.devt/state/scan-results.md` with:

- Files relevant to the task (grouped by module)
- Existing patterns to follow (with file references)
- Interfaces and contracts to satisfy
- Risks and constraints discovered

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=scan status=DONE
```

</step>

---

## Step 2.5: Regression Baseline (STANDARD + COMPLEX)

<step name="regression_baseline" gate="baseline-gates.md is written to .devt/state/ or step is skipped">

_Skip this step if complexity is SIMPLE._
_Skip this step if `config.workflow.regression_baseline` is `false`._

Run quality gates **before** implementation to establish a baseline. This captures the current pass/fail state so that any regressions introduced by the implementation can be detected.

```bash
# Read quality gate commands from .devt/rules/quality-gates.md and run them
# Capture output — failures here are PRE-EXISTING, not caused by this task
```

Write results to `.devt/state/baseline-gates.md`:

```markdown
# Baseline Quality Gates

Captured before implementation to detect regressions.

| Gate | Command | Result | Notes |
|------|---------|--------|-------|
| lint | {command} | PASS/FAIL | {pre-existing failures if any} |
| typecheck | {command} | PASS/FAIL | {pre-existing failures if any} |
| tests | {command} | PASS/FAIL ({N passed, M failed}) | {pre-existing failures if any} |
```

**Important**: Pre-existing failures are noted but NOT blocking. The baseline exists to compare AFTER implementation — new failures not in the baseline are regressions.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=regression_baseline status=DONE
```

</step>

---

## Step 2.7: Architecture Health Scan (COMPLEX only, optional)

<step name="arch_health" gate="user has decided whether to run arch-health scan">

_Only applies if complexity tier is COMPLEX._

Evaluate whether an architecture health scan should be recommended before implementation. Analyze the plan and scan results for architectural risk signals:

**Risk signals** (if ANY are true, recommend the scan):
- Plan touches 3+ modules or services
- Plan adds new cross-module dependencies
- Plan introduces a new architectural pattern (new service, new layer, new integration)
- Plan modifies shared infrastructure (core/, base classes, middleware)
- Plan changes database schema across multiple services
- Scan results show existing coupling or boundary violations in the affected area

**Present the recommendation via AskUserQuestion:**

```yaml
question: "This task has architectural risk signals. Run an architecture health scan before implementing?"
header: "Architecture Health Scan"
multiSelect: false
options:
  - label: "Yes — scan first (Recommended)"
    description: "Detect existing violations in affected modules before adding complexity. Findings feed into the architect review."
  - label: "Skip — proceed without scan"
    description: "Go straight to architect review and implementation"
```

If **no risk signals** detected, skip silently — do not ask.

**If user chooses Yes:**

Run the arch-health scan workflow inline (delta mode — only new findings since last baseline):

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=arch_health status=IN_PROGRESS
```

Dispatch the architect agent with the scan protocol:

```
Task(subagent_type="devt:architect", model="{models.architect}", prompt="
  <task>
    Run an architecture health scan on the modules affected by this task.
    Focus on: layer violations, coupling issues, circular dependencies, and convention drift.
    Classify each finding as: true positive, false positive, or pre-existing.
    Report only findings relevant to the planned changes.
  </task>
  <context>
    <files_to_read>.devt/rules/architecture.md, .devt/rules/coding-standards.md, CLAUDE.md</files_to_read>
    <scan_results>Read .devt/state/scan-results.md for affected modules</scan_results>
    <plan>Read .devt/state/plan.md for planned changes</plan>
    <skill>${CLAUDE_PLUGIN_ROOT}/skills/architecture-health-scanner/</skill>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
  </context>
  Write findings to .devt/state/arch-health-scan.md
")
```

**Gate check**: Read `.devt/state/arch-health-scan.md`:

- If true-positive findings exist in affected modules: pass them as additional context to the architect review (Step 3) and programmer (Step 4)
- If clean: proceed normally

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=arch_health status=DONE
```

**If user chooses Skip:** proceed to Step 3 directly.

</step>

---

## Step 3: Architecture Review (COMPLEX only)

<step name="architect" gate="arch-review.md is written to .devt/state/">

_Skip this step if complexity is SIMPLE or STANDARD._

Dispatch the architect agent to review the proposed approach before implementation:

```
Task(subagent_type="devt:architect", model="{models.architect}", prompt="
  <task>
    Review the architectural approach for: {task_description}
    Assess module boundaries, dependency direction, and structural impact.
    Identify risks before implementation begins.
  </task>
  <context>
    <files_to_read>.devt/rules/architecture.md, .devt/rules/coding-standards.md, CLAUDE.md</files_to_read>
    <scan_results>Read .devt/state/scan-results.md</scan_results>
    <spec>Read .devt/state/spec.md (if exists — from /devt:specify). Review intended design against architecture rules.</spec>
    <plan>Read .devt/state/plan.md (if exists)</plan>
    <arch_health>Read .devt/state/arch-health-scan.md (if exists — from Step 2.7). If present, factor existing violations into your review: flag any planned changes that would worsen existing issues.</arch_health>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
  </context>
  Write findings to .devt/state/arch-review.md
")
```

**Gate check**: Read `.devt/state/arch-review.md` and check status:

- DONE: proceed to implement
- DONE_WITH_CONCERNS: proceed to implement, but pass concerns to programmer as context:
  "Architecture review flagged concerns: [extract from arch-review.md]. Address these during implementation."
- BLOCKED: surface the blocking issue to the user and STOP
- NEEDS_CONTEXT: ask the user for clarification, then re-run this step

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=architect status=$STATUS
```

</step>

---

## Step 4: Implementation

<step name="implement" gate="impl-summary.md is written with status DONE or DONE_WITH_CONCERNS">

Initialize iteration tracking:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=implement status=IN_PROGRESS iteration=1
```

Dispatch the programmer agent:

```
Task(subagent_type="devt:programmer", model="{models.programmer}", prompt="
  <task>{task_description}</task>
  <context>
    <files_to_read>.devt/rules/coding-standards.md, .devt/rules/quality-gates.md, .devt/rules/architecture.md, CLAUDE.md</files_to_read>
    <scan_results>Read .devt/state/scan-results.md for existing patterns and code to reuse. If this file doesn't exist, the task was assessed as SIMPLE and no scan was performed.</scan_results>
    <arch_review>Read .devt/state/arch-review.md (if it exists)</arch_review>
    <spec>Read .devt/state/spec.md (if it exists — from /devt:specify). This is the primary requirements source with user stories, API design, and detailed acceptance criteria.</spec>
    <plan>Read .devt/state/plan.md (if it exists — from /devt:plan)</plan>
    <research>Read .devt/state/research.md (if it exists — from /devt:research)</research>
    <decisions>Read .devt/state/decisions.md (if it exists — from /devt:clarify)</decisions>
    <review_feedback>Read .devt/state/review.md (if this is a fix iteration)</review_feedback>
    <learning_context>{learning_context from context_init — relevant lessons from .devt/learning-playbook.md, if any}</learning_context>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
  </context>
  Write summary to .devt/state/impl-summary.md
")
```

**Gate check**: Read `.devt/state/impl-summary.md` and check status:

- DONE or DONE_WITH_CONCERNS: proceed to test
- BLOCKED: surface the issue to the user and STOP
- NEEDS_CONTEXT: ask the user for clarification, then re-dispatch

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=implement status=$STATUS
```

</step>

---

## Step 5: Testing

<step name="test" gate="test-summary.md is written with status DONE or DONE_WITH_CONCERNS">

_Skip this step if `test` is listed in `skipped_phases` from workflow state._

Dispatch the tester agent:

```
Task(subagent_type="devt:tester", model="{models.tester}", prompt="
  <task>
    Write comprehensive tests for the implementation described in .devt/state/impl-summary.md.
    Cover happy paths, error paths, edge cases, and boundary conditions.
    If a spec exists, ensure every test scenario from the spec has a corresponding test.
  </task>
  <context>
    <files_to_read>.devt/rules/testing-patterns.md, .devt/rules/quality-gates.md, CLAUDE.md</files_to_read>
    <impl_summary>Read .devt/state/impl-summary.md</impl_summary>
    <spec>Read .devt/state/spec.md (if exists — from /devt:specify). Use the "Test Scenarios" section as required coverage targets.</spec>
    <learning_context>{learning_context from context_init — relevant lessons from .devt/learning-playbook.md, if any}</learning_context>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
  </context>
  Write summary to .devt/state/test-summary.md
")
```

**Gate check**: Read `.devt/state/test-summary.md` and check status:

- DONE or DONE_WITH_CONCERNS: proceed to **simplify** (STANDARD/COMPLEX) or **review** (TRIVIAL/SIMPLE)
- BLOCKED: surface the issue to the user and STOP
- NEEDS_CONTEXT: ask the user for clarification, then re-dispatch

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=test status=$STATUS
```

</step>

---

## Step 5.5: Simplify (STANDARD + COMPLEX)

<step name="simplify" gate="code is cleaned up and quality gates still pass">

_Only applies if complexity tier is STANDARD or COMPLEX. Skip for TRIVIAL and SIMPLE._
_Skip this step if `simplify` is listed in `skipped_phases` from workflow state._

After tests pass, run a simplification pass on the changed code before it goes to review. This catches generative debt (redundancy, over-engineering, missed reuse) that the programmer's self-review may have missed.

Invoke the built-in `/simplify` skill, which spawns 3 parallel review agents (reuse, quality, efficiency) and applies fixes:

```
Skill(skill="simplify")
```

After simplify completes, **re-run quality gates** to ensure simplification didn't break anything:

```bash
# Read quality gate commands from project rules and execute
GATES_FILE=".devt/rules/quality-gates.md"
if [[ -f "$GATES_FILE" ]]; then
  echo "Re-running quality gates after simplification..."
  bash "${CLAUDE_PLUGIN_ROOT}/scripts/run-quality-gates.sh"
fi
```

**Gate check** — set `STATUS` based on outcome:

- Quality gates pass → `STATUS=DONE`, proceed to review
- Quality gates fail → attempt to fix (run failing command, read error, fix). Re-run gates.
  - Gates pass after fix → `STATUS=DONE`, proceed to review
  - Gates still fail → revert simplification changes (`git checkout -- <broken_files>`), `STATUS=REVERTED`, proceed to review with pre-simplify code. The original code was already tested and passing — safe to fall back.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=simplify status=$STATUS
```

</step>

---

## Step 6: Code Review

<step name="review" gate="review.md is written with verdict APPROVED or APPROVED_WITH_NOTES">

_Skip this step if `review` is listed in `skipped_phases` from workflow state._

Dispatch the code-reviewer agent:

```
Task(subagent_type="devt:code-reviewer", model="{models.code-reviewer}", prompt="
  <task>
    Review the implementation and tests for quality, correctness, and standards compliance.
    Review ALL code in scope — do not filter by origin or label findings as pre-existing.
  </task>
  <context>
    <files_to_read>.devt/rules/coding-standards.md, .devt/rules/architecture.md, .devt/rules/quality-gates.md, CLAUDE.md</files_to_read>
    <impl_summary>Read .devt/state/impl-summary.md</impl_summary>
    <test_summary>Read .devt/state/test-summary.md</test_summary>
    <decisions>Read .devt/state/decisions.md (if exists — from /devt:clarify)</decisions>
    <learning_context>{learning_context from context_init — relevant lessons from .devt/learning-playbook.md, if any}</learning_context>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
  </context>
  Write review to .devt/state/review.md
")
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

<step name="verify" gate="verification.md is written with status VERIFIED">

_Skip this step if complexity is SIMPLE._
_Skip this step if `config.workflow.verification` is `false`._
_Skip this step if `verify` is listed in `skipped_phases` from workflow state._

Dispatch the verifier agent:

```
Task(subagent_type="devt:verifier", model="{models.verifier}", prompt="
  <task>
    Verify the implementation achieves the original task goal.
    Use goal-backward verification: trace from requirements to code.
    If a spec exists, verify against its user stories, success criteria, and test scenarios — not just the task description.
  </task>
  <context>
    <original_task>{task_description}</original_task>
    <spec>Read .devt/state/spec.md (if exists — from /devt:specify). Use as primary acceptance criteria source.</spec>
    <files_to_read>.devt/state/impl-summary.md, .devt/state/test-summary.md, .devt/state/review.md, .devt/rules/quality-gates.md, CLAUDE.md</files_to_read>
    <baseline>Read .devt/state/baseline-gates.md (if exists). Compare current quality gate results against this baseline — tests that PASSED in baseline but FAIL now are regressions. Pre-existing failures are NOT regressions.</baseline>
    <plan>Read .devt/state/plan.md (if exists)</plan>
    <decisions>Read .devt/state/decisions.md (if exists)</decisions>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
  </context>
  Write verification to .devt/state/verification.md
")
```

**Gate check**: Read `.devt/state/verification.md` and check status:

- **VERIFIED**: Check if any acceptance criteria have `NEEDS_HUMAN` status. If so, emit a **Human Verify checkpoint** (even in autonomous mode) listing those specific items for the user to confirm:
  ```yaml
  question: "Verification passed, but {N} criteria need human confirmation:"
  header: "Human Verification Needed"
  ```
  List each NEEDS_HUMAN criterion with what the user should check. After user confirms (or in autonomous mode after a timeout), proceed to docs.
- **VERIFIED** with DONE_WITH_CONCERNS: proceed to docs, but report concerns to user:
  "Verification passed with concerns: [extract from verification.md]"
- **GAPS_FOUND** — apply the **repair operator** based on verify iteration:
  - Track verify iterations separately from review iterations (use VERIFY_ITER counter, starting at 0)
  - **VERIFY_ITER 0–1 → RETRY**: go back to **Step 4 (implement)** with gap list as feedback
    - `node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=verify verify_iteration=$((VITER+1)) verdict=GAPS_FOUND repair=RETRY`
    - The programmer agent reads `.devt/state/verification.md` as additional `<review_feedback>`
  - **VERIFY_ITER 2 → PRUNE**: stop iterating
    - Write remaining gaps to `.devt/state/scratchpad.md` under `## Deferred Verification Gaps`
    - Proceed with status DONE_WITH_CONCERNS
    - Report: "Verification gap limit reached. N gaps deferred to scratchpad."
    - `node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=verify verify_iteration=3 verdict=GAPS_FOUND repair=PRUNE`
- **FAILED**: surface to user as BLOCKED

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=verify status=$STATUS
```

</step>

---

## Step 7: Documentation (STANDARD + COMPLEX)

<step name="docs" gate="docs-summary.md is written to .devt/state/">

_Skip this step if complexity is SIMPLE._
_Skip this step if `config.workflow.docs` is `false`._
_Skip this step if `docs` is listed in `skipped_phases` from workflow state._

**Pre-dispatch check**: Read `.devt/state/impl-summary.md` status.

- If DONE or DONE_WITH_CONCERNS: dispatch docs-writer
- If BLOCKED: skip docs step (nothing to document)
- If file missing: skip docs step with warning "No implementation summary found"

Dispatch the docs-writer agent:

```
Task(subagent_type="devt:docs-writer", model="{models.docs-writer}", prompt="
  <task>
    Update module documentation to reflect the implementation changes.
    Update existing docs — do not create parallel documentation.
    Delete documentation for any removed features.
  </task>
  <context>
    <files_to_read>.devt/rules/documentation.md (if exists), CLAUDE.md</files_to_read>
    <impl_summary>Read .devt/state/impl-summary.md</impl_summary>
    <test_summary>Read .devt/state/test-summary.md</test_summary>
    <review>Read .devt/state/review.md</review>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
  </context>
  Write summary to .devt/state/docs-summary.md
")
```

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=docs status=DONE
```

</step>

---

## Step 8: Retrospective (STANDARD + COMPLEX)

<step name="retro" gate="lessons.yaml is written to .devt/state/">

_Skip this step if complexity is SIMPLE._
_Skip this step if `config.workflow.retro` is `false`._
_Skip this step if `retro` is listed in `skipped_phases` from workflow state._

Dispatch the retro agent:

```
Task(subagent_type="devt:retro", model="{models.retro}", prompt="
  <task>
    Review all workflow artifacts and extract lessons learned.
    Apply the 4-filter test: specific, generalizable, actionable, evidence-based.
    Discard anything that fails any filter.
  </task>
  <context>
    <files_to_read>
      .devt/state/impl-summary.md,
      .devt/state/test-summary.md,
      .devt/state/review.md,
      .devt/state/arch-review.md (if exists),
      .devt/state/docs-summary.md (if exists),
      CLAUDE.md (if exists),
      .devt/rules/coding-standards.md,
      .devt/rules/testing-patterns.md,
      .devt/learning-playbook.md (if exists)
    </files_to_read>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
  </context>
  Write lessons to .devt/state/lessons.yaml
")
```

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=retro status=DONE
```

</step>

---

## Step 9: Curation (COMPLEX only)

<step name="curate" gate="curation-summary.md is written and .devt/learning-playbook.md is updated">

_Skip this step if complexity is SIMPLE or STANDARD._

**Pre-dispatch check**: Read `.devt/state/lessons.yaml`.

- If file exists and has entries: dispatch curator
- If file exists but empty: skip curation (retro found no lessons)
- If file missing: skip curation with note "No lessons extracted"

Dispatch the curator agent:

```
Task(subagent_type="devt:curator", model="{models.curator}", prompt="
  <task>
    Evaluate incoming lessons from .devt/state/lessons.yaml.
    For each lesson: accept, merge, edit, reject, or archive.
    Update .devt/learning-playbook.md with accepted/merged entries.
    Prune expired or low-confidence entries.
  </task>
  <context>
    <files_to_read>.devt/learning-playbook.md (if exists), .devt/state/lessons.yaml, CLAUDE.md</files_to_read>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
  </context>
  Write summary to .devt/state/curation-summary.md
")
```

Sync the updated playbook to the FTS5 semantic database (non-blocking — grep fallback works if sync fails):

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" semantic sync
```

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=curate status=DONE
```

</step>

---

## Step 10: Autoskill (STANDARD + COMPLEX)

<step name="autoskill" gate="autoskill analysis is complete">

_Skip this step if complexity is SIMPLE._
_Skip this step if `config.workflow.autoskill` is `false`._
_Skip this step if `autoskill` is listed in `skipped_phases` from workflow state._

Read `${CLAUDE_PLUGIN_ROOT}/skills/autoskill/` for the autoskill protocol.

Analyze the completed workflow for patterns that could be automated:

- Repeated manual interventions that could become skills
- Agent prompt patterns that could be extracted into reusable templates
- Quality gate patterns that could be added to `.devt/rules/`

If actionable proposals are identified, write them to `.devt/state/autoskill-proposals.md`.
Report proposals to the user — do NOT auto-apply them.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=autoskill status=DONE
```

</step>

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

Summarize the workflow results:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=complete status=DONE active=false
```

Report to the user:

- **Complexity tier**: SIMPLE / STANDARD / COMPLEX
- **Steps executed**: list of steps that ran
- **Implementation**: files modified/created (from impl-summary.md)
- **Tests**: pass/fail counts (from test-summary.md)
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

**Failure recovery**: If a workflow phase is stuck in a fix loop or an agent repeatedly returns BLOCKED, consult `${CLAUDE_PLUGIN_ROOT}/guardrails/incident-runbook.md` for escalation procedures before giving up.
</deviation_rules>

<success_criteria>

- Implementation is complete (impl-summary.md status is DONE or DONE_WITH_CONCERNS)
- All tests pass (test-summary.md shows zero failures)
- Code review is APPROVED or APPROVED_WITH_NOTES (score >= 80)
- Verification passed (verification.md status is VERIFIED) — if STANDARD or COMPLEX
- Documentation is updated (if STANDARD or COMPLEX)
- Lessons are extracted and curated (if applicable)
- Final status: **DONE** or **DONE_WITH_CONCERNS**
  </success_criteria>
