# Research Task

Investigate implementation approaches before planning or coding.

<purpose>
Research the best approach for a task by scanning the codebase, identifying patterns,
and producing a prescriptive recommendation. This step prevents wrong approaches
and surfaces pitfalls before any code is written.
</purpose>

<available_agent_types>
- devt:researcher — technical investigation specialist, READ-ONLY (Read, Bash, Glob, Grep)
</available_agent_types>

<process>

<step name="init" gate="project context loaded">
## Step 1: Initialize

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" init workflow
```

Read .dev-rules/ for project conventions.
Read CLAUDE.md if it exists.
Read .devt-state/decisions.md if it exists (from /devt:clarify).
</step>

<step name="scope_check" gate="research scope determined">
## Step 2: Scope Check

Is research actually needed?

- **Known pattern** (simple CRUD, config change, well-documented feature): Skip research. Tell user: "This is a well-known pattern. Proceed directly with /devt:plan or /devt:implement."
- **Unfamiliar domain** (new integration, complex algorithm, multiple approaches): Proceed with research.
- **Multiple valid approaches** (architecture decision needed): Proceed with research.

If skipping, report why and suggest next command. Do NOT dispatch the researcher for trivial tasks.
</step>

<step name="research" gate="research.md is written to .devt-state/">
## Step 3: Dispatch Researcher

Task(subagent_type="devt:researcher", model="{models.architect}", prompt="
  <task>
    Research implementation approaches for: {task_description}
    Investigate the codebase for existing patterns, recommend an approach, identify pitfalls.
  </task>
  <context>
    <files_to_read>.dev-rules/coding-standards.md, .dev-rules/architecture.md</files_to_read>
    <decisions>Read .devt-state/decisions.md (if exists)</decisions>
    <template>${CLAUDE_PLUGIN_ROOT}/templates/research-template.md</template>
  </context>
  Write findings to .devt-state/research.md
")

Gate: Read .devt-state/research.md and check status:
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
Append answers to .devt-state/research.md.
</step>

<step name="next">
## Step 5: Suggest Next Step

Based on research completeness:
- If approach is clear: "Research complete. Run /devt:plan to create an implementation plan, or /devt:workflow to start implementing."
- If concerns flagged: "Research has concerns. Review .devt-state/research.md before proceeding."
- If user provided answers to open questions: update research.md and suggest proceeding.
</step>

</process>

<success_criteria>
- .devt-state/research.md exists with recommended approach
- All open questions resolved (or explicitly deferred)
- User has reviewed summary
</success_criteria>
