# Development Workflow

Full development pipeline with complexity-tiered execution: scan, implement, test, review, docs, retro, curate.

---

<prerequisites>
- `.devt.json` exists in project root (run `/init` first if not)
- `.dev-rules/` directory exists with project conventions
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
Before dispatching any agent, check `.devt.json` for an `agent_skills` configuration block:

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

If `agent_skills` is not configured or the key is missing for the agent type, omit the block entirely.
</agent_skill_injection>

---

## Context Loading

Before any step, initialize the workflow:

<step name="context_init" gate="compound init succeeds and .dev-rules/ is readable">

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" init workflow
```

This compound init:
1. Validates `.devt.json` exists and is valid
2. Creates/resets `.devt-state/` for a fresh workflow run
3. Records workflow start time and task description

Then load project context:
- Read `.dev-rules/coding-standards.md`
- Read `.dev-rules/architecture.md`
- Read `.dev-rules/quality-gates.md`
- Read `.dev-rules/testing-patterns.md`
- Read `CLAUDE.md` if it exists
- Search for relevant lessons: check `learning-playbook.md` for entries tagged with keywords from the task description
- Read `.devt-state/plan.md` if it exists (from `/devt:plan`)
  - If plan exists: use it to guide implementation (programmer reads it as context)
  - If no plan: proceed normally (programmer plans internally)
- Read `.devt-state/research.md` if it exists (from /devt:research)
  - If research.md has status DONE_WITH_CONCERNS, flag concerns to planner/programmer as additional context

Store the task description for reference by all subsequent steps.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=context_init status=DONE
```

Parse the init output JSON:
- If `workflow_lock.locked` is true: STOP. Report: "A workflow is already active. Run /devt:cancel-workflow first."
- If `dev_rules.missing_rules` is non-empty: WARN user which required files are missing
- If `warnings` array is non-empty: report each warning
- Store `models` for agent dispatch (use model values in Task() prompts)
- Store `config` for workflow behavior (model_profile, agent_skills)

**Gate**: If compound init fails, STOP with BLOCKED — the project is not configured.
</step>

---

## Step 1: Complexity Assessment

<step name="assess" gate="complexity tier is determined: SIMPLE, STANDARD, or COMPLEX">

Use the complexity-assessment skill to evaluate the task:

Read `${CLAUDE_PLUGIN_ROOT}/skills/complexity-assessment/` for the assessment rubric.

Evaluate the task against these dimensions:
- **Scope**: How many files/modules will be touched?
- **Risk**: Does it touch critical paths, data models, or cross-service boundaries?
- **Novelty**: Is this a well-trodden pattern or something new?
- **Dependencies**: Are there cross-cutting concerns (auth, audit, events)?

Assign a complexity tier:

| Tier | Criteria | Steps |
|------|----------|-------|
| **SIMPLE** | Single file/function, well-known pattern, no cross-cutting concerns | implement, test, review (3 steps) |
| **STANDARD** | Multiple files, follows existing patterns, minor cross-cutting | scan, implement, test, review, verify, docs, retro, curate (8 steps) |
| **COMPLEX** | New patterns, cross-service, architectural decisions needed | scan, architect, implement, test, review, verify, docs, retro, curate, autoskill (10 steps) |

Record the tier:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=assess complexity=$TIER
```

Report the tier and reasoning to the user before proceeding. The user can override the tier.

If tier is COMPLEX and no .devt-state/research.md exists:
  Suggest: "This is a complex task. Consider running /devt:research first to investigate approaches."
</step>

---

### Design Gate (COMPLEX tasks only)

<step name="design_gate" gate="plan must exist for COMPLEX tasks">

*Only applies if complexity tier is COMPLEX.*

If no `.devt-state/plan.md` exists:
  STOP. Tell the user:
  "This task was assessed as COMPLEX. A plan is required before implementation.
   Run `/devt:plan` first to create a validated implementation plan,
   then re-run `/devt:workflow`."

If `.devt-state/plan.md` exists: proceed to Step 2.

**Why**: COMPLEX tasks involve architectural decisions that should be planned and validated
before code is written. Skipping planning leads to rework.
</step>

---

### Optional: Clarify Assumptions

For STANDARD and COMPLEX tasks, consider running the clarify-task workflow first:
- Read `${CLAUDE_PLUGIN_ROOT}/workflows/clarify-task.md`
- Identify gray areas in the task
- Present choices to user, capture decisions in `.devt-state/decisions.md`
- The programmer agent will read this decisions document as additional context

This step is recommended but not mandatory. Skip for well-defined tasks with clear requirements.

---

## Step 2: Codebase Scan (STANDARD + COMPLEX)

<step name="scan" gate="scan-results.md is written to .devt-state/">

*Skip this step if complexity is SIMPLE.*

Use the codebase-scan skill to survey relevant code:

Read `${CLAUDE_PLUGIN_ROOT}/skills/codebase-scan/` for the scan protocol.

Scan for:
- Existing implementations related to the task (patterns to reuse)
- Module boundaries and interfaces involved
- Error types, constants, enums in the domain
- Existing tests for the affected modules
- Cross-module dependencies and integration points

Write results to `.devt-state/scan-results.md` with:
- Files relevant to the task (grouped by module)
- Existing patterns to follow (with file references)
- Interfaces and contracts to satisfy
- Risks and constraints discovered

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=scan status=DONE
```
</step>

---

## Step 3: Architecture Review (COMPLEX only)

<step name="architect" gate="arch-review.md is written to .devt-state/">

*Skip this step if complexity is SIMPLE or STANDARD.*

Dispatch the architect agent to review the proposed approach before implementation:

```
Task(subagent_type="devt:architect", model="{models.architect}", prompt="
  <task>
    Review the architectural approach for: {task_description}
    Assess module boundaries, dependency direction, and structural impact.
    Identify risks before implementation begins.
  </task>
  <context>
    <files_to_read>.dev-rules/architecture.md, .dev-rules/coding-standards.md</files_to_read>
    <scan_results>Read .devt-state/scan-results.md</scan_results>
    <agent_skills>{injected from .devt.json if available}</agent_skills>
  </context>
  Write findings to .devt-state/arch-review.md
")
```

**Gate check**: Read `.devt-state/arch-review.md` and check status:
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
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=implement iteration=1
```

Dispatch the programmer agent:

```
Task(subagent_type="devt:programmer", model="{models.programmer}", prompt="
  <task>{task_description}</task>
  <context>
    <files_to_read>.dev-rules/coding-standards.md, .dev-rules/quality-gates.md, .dev-rules/architecture.md</files_to_read>
    <scan_results>Read .devt-state/scan-results.md for existing patterns and code to reuse. If this file doesn't exist, the task was assessed as SIMPLE and no scan was performed.</scan_results>
    <arch_review>Read .devt-state/arch-review.md (if it exists)</arch_review>
    <plan>Read .devt-state/plan.md (if it exists — from /devt:plan)</plan>
    <review_feedback>Read .devt-state/review.md (if this is a fix iteration)</review_feedback>
    <agent_skills>{injected from .devt.json if available}</agent_skills>
  </context>
  Write summary to .devt-state/impl-summary.md
")
```

**Gate check**: Read `.devt-state/impl-summary.md` and check status:
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

Dispatch the tester agent:

```
Task(subagent_type="devt:tester", model="{models.tester}", prompt="
  <task>
    Write comprehensive tests for the implementation described in .devt-state/impl-summary.md.
    Cover happy paths, error paths, edge cases, and boundary conditions.
  </task>
  <context>
    <files_to_read>.dev-rules/testing-patterns.md, .dev-rules/quality-gates.md</files_to_read>
    <impl_summary>Read .devt-state/impl-summary.md</impl_summary>
    <agent_skills>{injected from .devt.json if available}</agent_skills>
  </context>
  Write summary to .devt-state/test-summary.md
")
```

**Gate check**: Read `.devt-state/test-summary.md` and check status:
- DONE or DONE_WITH_CONCERNS: proceed to review
- BLOCKED: surface the issue to the user and STOP
- NEEDS_CONTEXT: ask the user for clarification, then re-dispatch

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=test status=$STATUS
```
</step>

---

## Step 6: Code Review

<step name="review" gate="review.md is written with verdict APPROVED or APPROVED_WITH_NOTES">

Dispatch the code-reviewer agent:

```
Task(subagent_type="devt:code-reviewer", model="{models.code-reviewer}", prompt="
  <task>
    Review the implementation and tests for quality, correctness, and standards compliance.
    Review ALL code in scope — do not filter by origin or label findings as pre-existing.
  </task>
  <context>
    <files_to_read>.dev-rules/coding-standards.md, .dev-rules/architecture.md, .dev-rules/quality-gates.md</files_to_read>
    <impl_summary>Read .devt-state/impl-summary.md</impl_summary>
    <test_summary>Read .devt-state/test-summary.md</test_summary>
    <agent_skills>{injected from .devt.json if available}</agent_skills>
  </context>
  Write review to .devt-state/review.md
")
```

**Gate check**: Read `.devt-state/review.md` and check verdict:

- **APPROVED** or **APPROVED_WITH_NOTES**: proceed to next step
- **NEEDS_WORK**:
  - Read the current iteration count from `.devt-state/`
  - If iteration < 3: go back to **Step 4 (implement)** with review feedback
    - Increment iteration: `node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=review iteration=$((ITER+1)) verdict=NEEDS_WORK`
    - The programmer agent will read `.devt-state/review.md` as `<review_feedback>`
  - If iteration >= 3: surface all unresolved findings to the user and STOP
    - Report: "Code review returned NEEDS_WORK after 3 iterations. Unresolved findings require user input."
    - Status: BLOCKED

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=review status=$STATUS verdict=$VERDICT
```
</step>

---

## Step 6.5: Verification (STANDARD + COMPLEX)

<step name="verify" gate="verification.md is written with status VERIFIED">

*Skip this step if complexity is SIMPLE.*

Dispatch the verifier agent:

```
Task(subagent_type="devt:verifier", model="{models.code-reviewer}", prompt="
  <task>
    Verify the implementation achieves the original task goal.
    Use goal-backward verification: trace from requirements to code.
  </task>
  <context>
    <original_task>{task_description}</original_task>
    <files_to_read>.devt-state/impl-summary.md, .devt-state/test-summary.md, .devt-state/review.md</files_to_read>
    <plan>Read .devt-state/plan.md (if exists)</plan>
    <agent_skills>{injected from .devt.json if available}</agent_skills>
  </context>
  Write verification to .devt-state/verification.md
")
```

**Gate check**: Read `.devt-state/verification.md` and check status:

- **VERIFIED**: proceed to docs
- **VERIFIED** with DONE_WITH_CONCERNS: proceed to docs, but report concerns to user:
  "Verification passed with concerns: [extract from verification.md]"
- **GAPS_FOUND**: go back to **Step 4 (implement)** with gap list as feedback
  - This counts as a review iteration
  - Increment iteration: `node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=verify iteration=$((ITER+1)) verdict=GAPS_FOUND`
  - The programmer agent will read `.devt-state/verification.md` as additional `<review_feedback>`
  - If iteration >= 3: surface all unresolved gaps to the user and STOP
- **FAILED**: surface to user as BLOCKED

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=verify status=$STATUS
```
</step>

---

## Step 7: Documentation (STANDARD + COMPLEX)

<step name="docs" gate="docs-summary.md is written to .devt-state/">

*Skip this step if complexity is SIMPLE.*

**Pre-dispatch check**: Read `.devt-state/impl-summary.md` status.
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
    <files_to_read>.dev-rules/documentation.md (if exists)</files_to_read>
    <impl_summary>Read .devt-state/impl-summary.md</impl_summary>
    <test_summary>Read .devt-state/test-summary.md</test_summary>
    <review>Read .devt-state/review.md</review>
    <agent_skills>{injected from .devt.json if available}</agent_skills>
  </context>
  Write summary to .devt-state/docs-summary.md
")
```

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=docs status=DONE
```
</step>

---

## Step 8: Retrospective (STANDARD + COMPLEX)

<step name="retro" gate="lessons.yaml is written to .devt-state/">

*Skip this step if complexity is SIMPLE.*

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
      .devt-state/impl-summary.md,
      .devt-state/test-summary.md,
      .devt-state/review.md,
      .devt-state/arch-review.md (if exists),
      .devt-state/docs-summary.md (if exists)
    </files_to_read>
    <agent_skills>{injected from .devt.json if available}</agent_skills>
  </context>
  Write lessons to .devt-state/lessons.yaml
")
```

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=retro status=DONE
```
</step>

---

## Step 9: Curation (COMPLEX only)

<step name="curate" gate="curation-summary.md is written and learning-playbook.md is updated">

*Skip this step if complexity is SIMPLE or STANDARD.*

**Pre-dispatch check**: Read `.devt-state/lessons.yaml`.
- If file exists and has entries: dispatch curator
- If file exists but empty: skip curation (retro found no lessons)
- If file missing: skip curation with note "No lessons extracted"

Dispatch the curator agent:

```
Task(subagent_type="devt:curator", model="{models.curator}", prompt="
  <task>
    Evaluate incoming lessons from .devt-state/lessons.yaml.
    For each lesson: accept, merge, edit, reject, or archive.
    Update learning-playbook.md with accepted/merged entries.
    Prune expired or low-confidence entries.
  </task>
  <context>
    <files_to_read>learning-playbook.md (if exists), .devt-state/lessons.yaml</files_to_read>
    <agent_skills>{injected from .devt.json if available}</agent_skills>
  </context>
  Write summary to .devt-state/curation-summary.md
")
```

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=curate status=DONE
```
</step>

---

## Step 10: Autoskill (COMPLEX only)

<step name="autoskill" gate="autoskill analysis is complete">

*Skip this step if complexity is SIMPLE or STANDARD.*

Read `${CLAUDE_PLUGIN_ROOT}/skills/autoskill/` for the autoskill protocol.

Analyze the completed workflow for patterns that could be automated:
- Repeated manual interventions that could become skills
- Agent prompt patterns that could be extracted into reusable templates
- Quality gate patterns that could be added to `.dev-rules/`

If actionable proposals are identified, write them to `.devt-state/autoskill-proposals.md`.
Report proposals to the user — do NOT auto-apply them.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=autoskill status=DONE
```
</step>

---

## Workflow Completion

<step name="finalize" gate="final status is reported to user">

Summarize the workflow results:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=complete status=DONE
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
- **Artifacts created**: list all .devt-state/ files with sizes
  ```bash
  ls -la .devt-state/*.md .devt-state/*.yaml .devt-state/*.json 2>/dev/null
  ```
- **Overall status**: DONE | DONE_WITH_CONCERNS | BLOCKED

If DONE_WITH_CONCERNS, list the concerns.
If BLOCKED, explain what is blocking and what user action is needed.
</step>

---

<model_selection_guidance>
When dispatching agents, match model capability to task complexity:

| Task Type | Signal | Model |
|-----------|--------|-------|
| Mechanical implementation | Clear spec, 1-2 files, known pattern | Budget model (fast) |
| Integration work | Multiple files, cross-module coordination | Standard model |
| Architecture/design review | System-wide judgment, trade-offs | Best available model |
| Code review | Quality decisions, pattern detection | Best available model |
| Verification | Goal tracing, wiring checks, outcome validation | Best available model |
| Documentation | Straightforward updates | Budget model |
| Lesson extraction | Pattern recognition across artifacts | Standard model |

The `models` object from compound init provides the configured model per agent.
Override in .devt.json `model_overrides` for project-specific tuning.
</model_selection_guidance>

<deviation_rules>
1. **Auto-fix: bugs** — If a quality gate fails during implementation or testing, the responsible agent (programmer or tester) fixes it within their step. This does not count as a review iteration.
2. **Auto-fix: lint** — Linting failures detected during implementation are fixed immediately by the programmer agent before writing impl-summary.md. The fix loop is internal to the agent.
3. **Auto-fix: deps** — If a missing dependency is detected (import error, package not found), the programmer agent installs it following the project's package manager conventions and retries.
4. **STOP: architecture** — If the architect agent (Step 3) or code-reviewer agent (Step 6) identifies an architectural concern that requires a design decision (new pattern, boundary change, API contract change), the workflow STOPS and surfaces the decision to the user. Do NOT make architectural decisions autonomously.
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
