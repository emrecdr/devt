# Create Plan — Implementation Planning with Validation

Create a detailed, verified implementation plan before writing any code.

<purpose>
Prevent wrong approaches by planning first. The plan is validated before execution.
Plans that pass validation result in fewer iterations during implementation.
</purpose>

<available_agent_types>
- devt:architect — structural review for complex plans (READ-ONLY)
</available_agent_types>

<process>

<step name="init" gate="project context is loaded">
## Step 1: Initialize

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" init workflow
```

Read `.dev-rules/` for project conventions:
- Read `.dev-rules/coding-standards.md`
- Read `.dev-rules/architecture.md`
- Read `.dev-rules/quality-gates.md`
- Read `.dev-rules/testing-patterns.md`
- Read `CLAUDE.md` if it exists

Search for relevant lessons: check `learning-playbook.md` for entries tagged with keywords from the task description.
</step>

<step name="analyze" gate="task is fully understood">
## Step 2: Analyze Task

1. **Understand the request**: What is being asked? What is the expected outcome?
2. **Scan the codebase**: Use Glob and Grep to find existing implementations related to the task
   - Existing patterns to follow
   - Module boundaries and interfaces involved
   - Error types, constants, enums in the domain
   - Existing tests for affected modules
3. **Read `.devt-state/research.md`** if it exists (from /devt:research)
   - If research exists: follow the recommended approach, respect "Don't Hand-Roll" items
   - If no research: proceed normally (plan without prior research)
4. **Identify all files**: List every file that will be created or modified
5. **Identify dependencies**: What must exist before each piece can be built?
6. **Identify integration points**: Where does the new code connect to existing code?
7. **Identify risks and unknowns**: What could go wrong? What is unclear?

If unknowns exist that could change the approach, ask the user via AskUserQuestion before proceeding.
Do NOT guess at ambiguous requirements — ask.
</step>

<step name="plan" gate="plan document is written">
## Step 3: Create Plan

Write `.devt-state/plan.md` using the template at `${CLAUDE_PLUGIN_ROOT}/templates/implementation-plan-template.md`.

The plan must include:

### Goal
One sentence: what this builds and why.

### Files Table
| Action | Path | Purpose |
|--------|------|---------|
| Create | `path/to/new.py` | [what it does] |
| Modify | `path/to/existing.py` | [what changes] |

### Ordered Tasks
Each task must have:
- [ ] Concrete steps (2-5 minutes each)
- Exact commands to run for verification
- Expected outputs for each command
- Files involved

Tasks must be ordered so that dependencies are built before dependents.

### Verification Checklist
- [ ] All quality gates pass
- [ ] All tests pass
- [ ] No TODO/FIXME markers in new code
- [ ] New code is wired (imported, registered, reachable)
- [ ] Each acceptance criterion is met
</step>

<step name="validate" gate="plan passes validation">
## Step 4: Validate Plan

Check the plan against these criteria:

**Completeness**: Does every requirement from the task map to at least one task in the plan?
- List each requirement and its corresponding task number
- If any requirement has no task, the plan is incomplete

**Feasibility**: Do referenced files and functions actually exist?
- For each file in the "Modify" column, verify it exists with Glob
- For each function/class referenced, verify it exists with Grep
- If a file does not exist and the plan says "Modify", the plan is wrong

**Order**: Are dependencies respected?
- No task should use something created by a later task
- Trace the dependency chain: if Task 3 imports from Task 1, Task 1 must come first

**Scope**: No scope creep
- Every task must trace back to the original request
- Remove any task that is "nice to have" but not requested

**Conventions**: Does the approach follow `.dev-rules/`?
- Architecture boundaries respected
- Coding standards followed
- Testing patterns used correctly

**CLAUDE.md compliance**: Does the plan respect project constraints?
- No violations of project-specific rules

If validation finds issues:
1. Fix the plan in `.devt-state/plan.md`
2. Re-validate (max 3 iterations)
3. If still failing after 3 iterations: present remaining issues to user via AskUserQuestion
</step>

<step name="architecture_check" gate="architect approves or task is simple">
## Step 5: Architecture Check (if plan touches 3+ modules)

If the plan modifies files across 3 or more modules/directories:

Dispatch the architect agent for structural review:

```
Task(subagent_type="devt:architect", model="{models.architect}", prompt="
  <task>Review this implementation plan for architectural soundness.</task>
  <context>
    <files_to_read>.dev-rules/architecture.md, .devt-state/plan.md</files_to_read>
  </context>
  Write review to .devt-state/arch-review.md
")
```

**Gate check**: Read `.devt-state/arch-review.md`:
- DONE or DONE_WITH_CONCERNS: incorporate any concerns into the plan, then proceed
- BLOCKED: surface blocking issue to user and STOP
- NEEDS_CONTEXT: ask user for clarification, then re-run

If the plan touches fewer than 3 modules, skip this step.
</step>

<step name="present" gate="user approves plan">
## Step 6: Present to User

Show the plan summary:
- **Task goal**: one sentence
- **Files to change**: count of create vs modify
- **Tasks**: count and brief description of each
- **Estimated complexity**: SIMPLE / STANDARD / COMPLEX
- **Risks**: any identified risks or unknowns
- **Architect concerns**: any issues raised (if architecture check ran)

Ask user: "Proceed with this plan? You can also request changes before execution."

If user approves: report plan location (`.devt-state/plan.md`) and suggest running `/devt:workflow` to execute.
If user requests changes: revise the plan and re-present.
</step>

</process>

<success_criteria>
- Plan is written to `.devt-state/plan.md`
- All referenced files verified to exist (for modifications)
- Plan passes validation (completeness, feasibility, order, scope, conventions)
- Architecture reviewed (if multi-module)
- User has approved the plan
</success_criteria>
