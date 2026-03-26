# Debug — Systematic Investigation

Dispatch a debugger agent to investigate and fix a bug.

<process>

<step name="init">
Read .dev-rules/coding-standards.md and .dev-rules/quality-gates.md for context.
</step>

<step name="gather_symptoms">
## Gather Symptoms

Before dispatching debugger, capture:
- What is the expected behavior?
- What is the actual behavior?
- Error message (if any)
- Steps to reproduce
- When did it start? (recent change?)

Write to .devt-state/debug-context.md
</step>

<step name="dispatch">
## Dispatch Debugger

Task(subagent_type="devt:debugger", model="{models.programmer}", prompt="
  <bug>{bug_description}</bug>
  <context>
    <files_to_read>.dev-rules/coding-standards.md, .dev-rules/quality-gates.md</files_to_read>
    <symptoms>Read .devt-state/debug-context.md</symptoms>
  </context>
  Follow the 4-phase investigation protocol. Write findings to .devt-state/debug-summary.md
")
</step>

<step name="report">
## Report Results

Read .devt-state/debug-summary.md:
- FIXED: report fix, suggest running quality gates
- NEEDS_MORE_INVESTIGATION: show what was discovered, suggest re-running /devt:debug
- BLOCKED: surface root cause analysis, suggest architectural review
</step>

</process>
