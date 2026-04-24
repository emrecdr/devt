# Create Plan — Implementation Planning with Validation

Create a detailed, verified implementation plan before writing any code.

<purpose>
Prevent wrong approaches by planning first. The plan is validated before execution.
Plans that pass validation result in fewer iterations during implementation.
</purpose>

<prerequisites>
- `.devt/rules/` directory exists with coding-standards.md, architecture.md, quality-gates.md
- `${CLAUDE_PLUGIN_ROOT}` is set (devt plugin is loaded)
- `node` is available on PATH
</prerequisites>

<available_agent_types>

- devt:researcher — technical investigation specialist, READ-ONLY (Read, Bash, Glob, Grep)
- devt:architect — structural review for complex plans (READ-ONLY)
  </available_agent_types>

<agent_skill_injection>
Before dispatching agents, check `.devt/config.json` for `agent_skills.<agent_type>`. If not configured, consult `${CLAUDE_PLUGIN_ROOT}/skill-index.yaml` for defaults:
- researcher: codebase-scan, strategic-analysis
- architect: codebase-scan, architecture-health-scanner, api-docs-fetcher, strategic-analysis, complexity-assessment
</agent_skill_injection>

<process>

<step name="init" gate="project context is loaded">
## Step 1: Initialize

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" init workflow
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update active=true workflow_type=plan phase=context_init status=IN_PROGRESS stopped_at=null stopped_phase=null verdict=null repair=null verify_iteration=0 resume_context=null "task=${TASK_DESCRIPTION}"
```

Read `.devt/rules/` for project conventions:

- Read `.devt/rules/coding-standards.md`
- Read `.devt/rules/architecture.md`
- Read `.devt/rules/quality-gates.md`
- Read `.devt/rules/testing-patterns.md`
- Read `CLAUDE.md` if it exists
- Read `.devt/state/decisions.md` if it exists (from `/devt:clarify` or `/devt:specify`) — decisions constrain the plan and must be respected. Reference DEC-xxx IDs when tasks implement specific decisions.

Search for relevant lessons: check `.devt/learning-playbook.md` for entries tagged with keywords from the task description.
</step>

<step name="research_gate" gate="research is complete, skipped, or already exists">
## Step 2: Auto-Research (conditional)

Check if research is needed before planning:

1. **Already exists?** Read `.devt/state/research.md` — if it exists with status DONE, skip research (use existing findings).
2. **Needs research?** Evaluate the task:
   - **Skip research** if: well-known pattern (CRUD, config change), single file, no external integrations, no architectural decisions
   - **Run research** if: unfamiliar domain, multiple valid approaches, new integrations, spec mentions technologies not yet in the codebase

3. **If research is needed and no existing research.md:**

   Ask the user via AskUserQuestion:

   ```yaml
   question: "This task involves approaches worth investigating before planning. Run research first?"
   header: "Research Gate"
   multiSelect: false
   options:
     - label: "Research first (Recommended)"
       description: "Investigate patterns, libraries, and pitfalls before creating the plan — best for new features, unfamiliar integrations, or architectural decisions"
     - label: "Skip research"
       description: "Plan directly from context and conventions — best for bug fixes, simple refactors, or well-understood tasks"
   ```

4. **If research selected:** Dispatch the researcher agent:

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

   Gate: Read `.devt/state/research.md` — if DONE or DONE_WITH_CONCERNS, proceed. If NEEDS_CONTEXT, ask user and re-dispatch.

5. **If research skipped:** proceed to Step 3 without research context.

6. **Open Questions gate** (applies when `.devt/state/research.md` exists with status DONE or DONE_WITH_CONCERNS):
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
           description: "Mark questions as [DEFERRED] in research.md and proceed with planning"
         - label: "Proceed anyway"
           description: "Continue planning despite unresolved questions — risk of incomplete plan"
       ```
     - If user defers: mark each unresolved question as [DEFERRED] in research.md and proceed
     - If user resolves: update research.md with the answers and proceed
     - If user says proceed anyway: note the risk in plan.md and continue
</step>

<step name="analyze" gate="task is fully understood">
## Step 3: Analyze Task

1. **Understand the request**: What is being asked? What is the expected outcome?
2. **Scan the codebase**: Use Glob and Grep to find existing implementations related to the task
   - Existing patterns to follow
   - Module boundaries and interfaces involved
   - Error types, constants, enums in the domain
   - Existing tests for affected modules
3. **Read `.devt/state/spec.md`** if it exists (from /devt:specify)
   - If spec exists: use it as the primary requirements source — decisions, API design, test scenarios, tasks
   - If no spec: derive requirements from the task description
4. **Read `.devt/state/research.md`** if it exists (from Step 2 or prior /devt:research)
   - If research exists: follow the recommended approach, respect "Don't Hand-Roll" items
   - If no research: proceed normally (plan without prior research)
5. **Identify all files**: List every file that will be created or modified
6. **Identify dependencies**: What must exist before each piece can be built?
7. **Identify integration points**: Where does the new code connect to existing code?
8. **Identify risks and unknowns**: What could go wrong? What is unclear?

If unknowns exist that could change the approach, ask the user via AskUserQuestion before proceeding.
Do NOT guess at ambiguous requirements — ask.
</step>

<step name="plan" gate="plan document is written">
## Step 4: Create Plan

Write `.devt/state/plan.md` using the template at `${CLAUDE_PLUGIN_ROOT}/templates/implementation-plan-template.md`.

The plan must include:

### Goal

One sentence: what this builds and why.

### Files Table

| Action | Path                  | Purpose        |
| ------ | --------------------- | -------------- |
| Create | `path/to/new_file`      | [what it does] |
| Modify | `path/to/existing_file` | [what changes] |

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
## Step 5: Validate Plan

Check the plan against these criteria:

**Completeness**: Does every requirement map to at least one task in the plan?

If `.devt/state/spec.md` exists (from `/devt:specify`), trace from the spec:
- List each user story from the spec and its corresponding plan task(s)
- List each success criterion and verify it is covered by a task
- List each in-scope item and verify it has a task
- If any spec item has no task, the plan is incomplete

If no spec exists, trace from the task description:
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

**Conventions**: Does the approach follow `.devt/rules/`?

- Architecture boundaries respected
- Coding standards followed
- Testing patterns used correctly

**CLAUDE.md compliance**: Does the plan respect project constraints?

- No violations of project-specific rules

If validation finds issues:

1. Fix the plan in `.devt/state/plan.md`
2. Re-validate (max 3 iterations)
3. If still failing after 3 iterations: present remaining issues to user via AskUserQuestion
   </step>

<step name="architecture_check" gate="architect approves or task is simple">
## Step 6: Architecture Check (if plan touches 3+ modules)

If the plan modifies files across 3 or more modules/directories:

Dispatch the architect agent for structural review:

```
Task(subagent_type="devt:architect", model="{models.architect}", prompt="
  <task>Review this implementation plan for architectural soundness.</task>
  <context>
    <files_to_read>.devt/rules/architecture.md, .devt/state/plan.md</files_to_read>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
  </context>
  Write review to .devt/state/arch-review.md
")
```

**Gate check**: Read `.devt/state/arch-review.md`:

- DONE or DONE_WITH_CONCERNS: incorporate any concerns into the plan, then proceed
- BLOCKED: surface blocking issue to user and STOP
- NEEDS_CONTEXT: ask user for clarification, then re-run

If the plan touches fewer than 3 modules, skip this step.
</step>

<step name="present" gate="user approves plan">
## Step 7: Present to User

Show the plan summary:

- **Task goal**: one sentence
- **Files to change**: count of create vs modify
- **Tasks**: count and brief description of each
- **Estimated complexity**: SIMPLE / STANDARD / COMPLEX
- **Risks**: any identified risks or unknowns
- **Architect concerns**: any issues raised (if architecture check ran)

Then ask the user what to do next via AskUserQuestion:

```yaml
question: "Plan is ready. What would you like to do?"
header: "Next Step"
multiSelect: false
options:
  - label: "Start implementation (/devt:workflow)"
    description: "Execute the plan through the full development pipeline"
  - label: "Request changes"
    description: "Revise the plan before proceeding"
  - label: "Done for now"
    description: "Save the plan and come back later"
```

If the user selects implementation, execute `/devt:workflow` with the task description.
If the user requests changes, revise the plan and re-present.
If "Done for now", report the plan location (`.devt/state/plan.md`) and stop.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update active=false phase=complete status=DONE
```
</step>

</process>

<success_criteria>

- Plan is written to `.devt/state/plan.md`
- All referenced files verified to exist (for modifications)
- Plan passes validation (completeness, feasibility, order, scope, conventions)
- Architecture reviewed (if multi-module)
- User has approved the plan
  </success_criteria>

<deviation_rules>

1. **Researcher returns BLOCKED**: The research topic may be too broad or require external access. Narrow the scope to codebase-observable facts and retry. If still blocked, proceed to planning with available context and note the gap.
2. **Architect returns BLOCKED**: Architectural constraints may conflict with the task requirements. Surface the conflict to the user before proceeding — the plan must not include steps that violate architecture rules.
3. **Validation fails repeatedly**: If the plan fails validation after 2 revision attempts, present the validation failures to the user and ask for guidance rather than continuing to iterate.
4. **User abandons plan at review**: If the user says "stop" or "cancel" during review, save the current plan state to `.devt/state/plan.md` with a `status: DRAFT` header so it can be resumed later.

</deviation_rules>
