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
Before dispatching the researcher agent, check `.devt/config.json` for `agent_skills.researcher`. If not configured, consult `${CLAUDE_PLUGIN_ROOT}/skill-index.yaml` for defaults (codebase-scan, strategic-analysis).
</agent_skill_injection>

<process>

<step name="init" gate="project context loaded">
## Step 1: Initialize

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" init workflow
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update active=true workflow_type=research phase=context_init status=IN_PROGRESS stopped_at=null stopped_phase=null "task=${TASK_DESCRIPTION}"
```

Read .devt/rules/ for project conventions.
Read CLAUDE.md if it exists.
Read .devt/state/decisions.md if it exists (from /devt:clarify).
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

Task(subagent_type="devt:researcher", model="{models.researcher}", prompt="
<task>
Research implementation approaches for: {task_description}
Investigate the codebase for existing patterns, recommend an approach, identify pitfalls.
</task>
<context>
<files_to_read>.devt/rules/coding-standards.md, .devt/rules/architecture.md</files_to_read>
<spec>Read .devt/state/spec.md (if exists — from /devt:specify)</spec>
<decisions>Read .devt/state/decisions.md (if exists)</decisions>
<template>${CLAUDE_PLUGIN_ROOT}/templates/research-template.md</template>
<agent_skills>{injected from .devt/config.json if available}</agent_skills>
</context>
Write findings to .devt/state/research.md
")

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
Append answers to .devt/state/research.md.
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
4. **STOP: research inconclusive** — If no clear recommendation emerges after scanning, present the trade-offs honestly rather than forcing a pick. Let the user decide.
</deviation_rules>

<success_criteria>

- .devt/state/research.md exists with recommended approach
- All open questions resolved (or explicitly deferred)
- User has reviewed summary
  </success_criteria>
