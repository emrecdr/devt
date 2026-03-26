# Quick Implementation Workflow

Fast-path development cycle: scan, implement, test, review. Skips documentation, retrospective, and curation for speed.

---

<prerequisites>
- `.devt.json` exists in project root (run `/init` first if not)
- `.dev-rules/` directory exists with project conventions
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

## Steps

<step name="context_init" gate="compound init succeeds and .dev-rules/ is readable">

Initialize the workflow:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" init workflow
```

Load project context:
- Read `.dev-rules/coding-standards.md`
- Read `.dev-rules/architecture.md`
- Read `.dev-rules/quality-gates.md`
- Read `.dev-rules/testing-patterns.md`
- Read `CLAUDE.md` if it exists

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=context_init status=DONE
```

**Gate**: If compound init fails, STOP with BLOCKED.
</step>

<step name="scan" gate="scan-results.md is written to .devt-state/">

Perform a brief codebase scan focused on the task:

Read `${CLAUDE_PLUGIN_ROOT}/skills/codebase-scan/` for the scan protocol.

Scan for:
- Existing patterns to reuse (prioritize over inventing new ones)
- Interfaces and contracts the implementation must satisfy
- Existing tests to understand testing conventions
- Error types and domain constants

Keep the scan focused — do not map the entire codebase. Find what is needed for THIS task.

Write results to `.devt-state/scan-results.md`.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=scan status=DONE
```
</step>

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
    <scan_results>Read .devt-state/scan-results.md</scan_results>
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

<step name="test" gate="test-summary.md is written with status DONE or DONE_WITH_CONCERNS">

Dispatch the tester agent:

```
Task(subagent_type="devt:tester", model="{models.tester}", prompt="
  <task>
    Write tests for the implementation described in .devt-state/impl-summary.md.
    Cover happy paths, error paths, and key edge cases.
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

- **APPROVED** or **APPROVED_WITH_NOTES**: proceed to finalize
- **NEEDS_WORK**:
  - Read the current iteration count
  - If iteration < 2: go back to **implement** with review feedback
    - Increment iteration: `node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=review iteration=$((ITER+1)) verdict=NEEDS_WORK`
    - The programmer agent reads `.devt-state/review.md` as `<review_feedback>`
  - If iteration >= 2: surface all unresolved findings to the user and STOP
    - Report: "Review returned NEEDS_WORK after 2 iterations. Remaining findings require user input."
    - Status: BLOCKED

*Note: Quick-implement limits review iterations to 2 (vs 3 in full workflow) for speed.
Architectural issues still surface to user via BLOCKED status.*

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=review status=$STATUS verdict=$VERDICT
```
</step>

<step name="finalize" gate="final status is reported to user">

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=complete status=DONE
```

Report to the user:
- **Implementation**: files modified/created (from impl-summary.md)
- **Tests**: pass/fail counts (from test-summary.md)
- **Review verdict**: APPROVED / APPROVED_WITH_NOTES
- **Review score**: N/100
- **Iterations**: how many implement-review cycles occurred
- **Overall status**: DONE | DONE_WITH_CONCERNS | BLOCKED
</step>

---

<deviation_rules>
1. **Auto-fix: bugs** — If a quality gate fails during implementation or testing, the responsible agent fixes it within their step. No separate iteration.
2. **Auto-fix: lint** — Linting failures are fixed immediately by the programmer agent before writing impl-summary.md.
3. **Auto-fix: deps** — Missing dependencies are installed by the programmer agent following project package manager conventions.
4. **STOP: architecture** — If the code-reviewer identifies an architectural concern requiring a design decision, the workflow STOPS and surfaces to the user. Do NOT make architectural decisions autonomously.
</deviation_rules>

<success_criteria>
- Implementation is complete (impl-summary.md status is DONE or DONE_WITH_CONCERNS)
- All tests pass (test-summary.md shows zero failures)
- Code review is APPROVED or APPROVED_WITH_NOTES (score >= 80)
- Final status: **DONE** or **DONE_WITH_CONCERNS**
</success_criteria>
