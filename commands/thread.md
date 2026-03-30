---
name: thread
description: Persistent context threads for cross-session work — create, list, or resume investigation threads that survive session boundaries. Use for multi-session debugging, research, or explorations.
---

<tool_restrictions>
This workflow uses: Read, Write, Bash, Glob
</tool_restrictions>

<objective>
Manage lightweight context threads that persist across sessions.
Threads are lighter than full workflow state — just goal, context, and next steps.
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/thread.md
</execution_context>

<process>
Execute the thread workflow.
Subcommands: /devt:thread create <title>, /devt:thread list, /devt:thread resume <N>
</process>
