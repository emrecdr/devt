# Clarify Task

Pre-implementation step that identifies gray areas and captures decisions before any code is written.

---

<purpose>
Prevent wrong assumptions by discussing implementation choices with the user before coding.
This step is optional but recommended for STANDARD and COMPLEX tasks.
</purpose>

<prerequisites>
- `${CLAUDE_PLUGIN_ROOT}` is set (devt plugin is loaded)
- The user has provided a task description as the command argument
</prerequisites>

<available_agent_types>
This workflow does NOT use subagents. All steps are executed by the main session.
</available_agent_types>

<agent_skill_injection>
Not applicable — this workflow does not dispatch subagents.
</agent_skill_injection>

<deviation_rules>
1. **Auto-fix: minor issues** — Fix typos, formatting, and obvious errors inline
2. **STOP: scope creep** — If the task grows beyond clarification into implementation, suggest /devt:workflow or /devt:implement instead
3. **STOP: decision fatigue** — If the user expresses frustration with too many questions, capture remaining gray areas as assumptions and move on
</deviation_rules>

<process>

<step name="analyze" gate="gray areas identified">
## Step 1: Analyze the Task

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update active=true workflow_type=clarify phase=context_init status=IN_PROGRESS stopped_at=null stopped_phase=null verdict=null repair=null verify_iteration=0 resume_context=null "task=${TASK_DESCRIPTION}"
```

Read `${CLAUDE_PLUGIN_ROOT}/references/questioning-guide.md` — how to question effectively. Follow the guide's philosophy: be a thinking partner, not an interviewer.

Read `${CLAUDE_PLUGIN_ROOT}/references/domain-probes.md` — structured probes for discovering domain unknowns, constraints, and edge cases. Use selectively based on the task's domain complexity.

Read the task description and identify:

1. What is clearly specified (no ambiguity)
2. What has multiple valid approaches (gray areas)
3. What assumptions you would make if not asked

Focus on decisions the user CARES about — not technical trivia. Ask about:

- User-visible behavior choices (not internal implementation details)
- Data model decisions that are hard to change later
- Integration points where multiple approaches exist
- Scope boundaries (what's in vs out)
  </step>

<step name="discuss" gate="all gray areas have decisions">
## Step 2: Present Gray Areas

For each gray area, present:

- The decision to make (one sentence)
- Option A vs Option B (with trade-offs)
- Your recommendation with reasoning

Use AskUserQuestion for each decision. One question at a time.

**Scope guardrail**: If the user suggests adding features beyond the task scope, acknowledge the idea and suggest capturing it as a follow-up. Do NOT expand the current task scope.
</step>

<step name="capture" gate="decisions document written">
## Step 3: Capture Decisions

Write `.devt/state/decisions.md` with:

- Task description
- Each decision with a **decision ID** (DEC-001, DEC-002, ...): what was decided, why, alternatives considered
- Any assumptions that were validated
- Scope boundaries confirmed

Decision IDs enable traceability — plan.md and impl-summary.md can reference specific decisions by ID (e.g., "Per DEC-003, using repository pattern").

```markdown
# Decisions

## Task
{task description}

## DEC-001: {decision title}
**Decision**: {what was decided}
**Why**: {reasoning}
**Alternatives**: {what was considered and rejected}

## DEC-002: {decision title}
...

## Assumptions
- {validated assumption}

## Scope
- In scope: {what's included}
- Out of scope: {what's excluded}
```

This document feeds into the programmer agent's context.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update active=false phase=complete status=DONE
```
</step>

</process>

<modes>
## Clarify Modes

This workflow supports two modes, selected by the user via the command argument:

### Default Mode (interview)
The standard process above: identify gray areas, ask questions one at a time, capture decisions.
Best for: new projects, unfamiliar domains, tasks with many unknowns.

### Assumptions Mode (`--assumptions`)
Codebase-first approach that minimizes user interaction:

1. **Scan**: Read 5-15 relevant source files to understand existing patterns, conventions, and data models
2. **Form assumptions**: For each gray area, form an assumption based on what the codebase already does
3. **Rate confidence**: Tag each assumption as **Confident** (strong codebase evidence), **Likely** (partial evidence), or **Unclear** (no evidence)
4. **Present for confirmation**: Show ALL assumptions to the user in a single batch:
   - Confident assumptions: "I'll proceed with these unless you object"
   - Likely assumptions: "These seem right based on the code — confirm or correct"
   - Unclear assumptions: "I need your input on these"
5. **Capture**: Write confirmed/corrected assumptions to `.devt/state/decisions.md` using the same DEC-xxx format

Best for: established codebases with clear patterns, tasks extending existing functionality.
Typical interaction count: 2-4 (vs 10-15 for interview mode).

The mode is determined by the command argument. If `--assumptions` is passed, use assumptions mode.
Otherwise, use default interview mode.
</modes>

<success_criteria>

- All identified gray areas have user decisions (or confirmed assumptions)
- Decisions captured in .devt/state/decisions.md with DEC-xxx IDs
- No unresolved ambiguity remains
  </success_criteria>
