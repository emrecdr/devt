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

**Auto-fire Pre-Flight Brief**:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" preflight generate "${TASK_DESCRIPTION}"
```

Produces `.devt/state/preflight-brief.md`. The programmer agent reads it before edits. Skip silently if the call fails.

**Gate**: If compound init fails, STOP with BLOCKED.
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

**Orchestrator-prep — compute the memory signal** before the dispatch so the agent's initial scan can use it instead of per-doc `memory query` round trips:

```bash
MEMORY_SIGNAL=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" memory query "{task_description}" --signal=3 --json-compact 2>/dev/null || echo '{}')
```

Dispatch the programmer agent:

```
Task(subagent_type="devt:programmer", model="{models.programmer}", prompt="
  <context>
    <files_to_read>.devt/rules/coding-standards.md, .devt/rules/quality-gates.md, .devt/rules/architecture.md, CLAUDE.md</files_to_read>
    <!-- KEEP IN SYNC: the <memory_signal> block + its orchestrator-prep step
         are duplicated across programmer + code-reviewer + verifier dispatches
         in dev-workflow.md, code-review.md, and quick-implement.md. When the
         CLI shape or block position changes, update all five. -->
    <memory_signal>{memory_signal_json}</memory_signal>
    <scan_results>Read .devt/state/scan-results.md (if exists)</scan_results>
    <spec>Read .devt/state/spec.md (if exists — from /devt:specify)</spec>
    <research>Read .devt/state/research.md (if exists — from /devt:research)</research>
    <decisions>Read .devt/state/decisions.md (if exists)</decisions>
    <review_feedback>Read .devt/state/review.md (if this is a fix iteration)</review_feedback>
    <learning_context>{learning_context from context_init — relevant lessons from .devt/memory/lessons/ via Pre-Flight Brief, if any}</learning_context>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
  </context>
  <task>{task_description}</task>
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

</step>

<step name="test" gate="test-summary.json is written with status DONE or DONE_WITH_CONCERNS">

Dispatch the tester agent:

```
Task(subagent_type="devt:tester", model="{models.tester}", prompt="
  <context>
    <files_to_read>.devt/rules/testing-patterns.md, .devt/rules/quality-gates.md, CLAUDE.md</files_to_read>
    <impl_summary>Read .devt/state/impl-summary.md</impl_summary>
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

**Orchestrator-prep — compute the memory signal** before dispatch so the reviewer can spot REJ-tombstone matches without per-doc round trips:

```bash
MEMORY_SIGNAL=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" memory query "{task_description}" --signal=3 --json-compact 2>/dev/null || echo '{}')
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
    <impl_summary>Read .devt/state/impl-summary.md</impl_summary>
    <test_summary>Read .devt/state/test-summary.md</test_summary>
    <decisions>Read .devt/state/decisions.md (if exists)</decisions>
    <learning_context>{learning_context from context_init — relevant review/quality lessons from .devt/memory/lessons/ via Pre-Flight Brief, if any}</learning_context>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
  </context>
  <task>
    Review the implementation and tests for quality, correctness, and standards compliance.
    Review ALL code in scope — do not filter by origin or label findings as pre-existing.
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

Even though quick-implement skips retro+curator for speed, the harvest itself is unconditional — observations from this workflow are buffered into `.devt/memory/_suggestions.md` for the next dev-workflow's curator to review. This prevents the "fast workflow drops all knowledge candidates on the floor" footgun. Cost: ~50ms when claude-mem is absent.

```bash
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
