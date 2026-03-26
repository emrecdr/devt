---
name: fast
description: Execute a trivial task inline — no subagents, no planning overhead. For tasks touching 3 or fewer files with no architectural impact.
---

<tool_restrictions>
This workflow uses: Bash, Read, Write, Edit, Glob, Grep
</tool_restrictions>

<objective>
Execute a small, well-scoped task directly without subagent dispatch. Validates the task is genuinely trivial via a scope gate before proceeding. If the task is too complex, redirects to /devt:implement.
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/fast.md
</execution_context>

<process>
Execute the fast inline workflow from the referenced file end-to-end. The task description is provided as the command argument.
</process>
