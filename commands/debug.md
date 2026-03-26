---
name: debug
description: Systematic debugging with 4-phase investigation — root cause first, then fix. Isolates in fresh context to preserve your main session.
---

<tool_restrictions>
This workflow uses: Read, Write, Edit, Bash, Glob, Grep, Agent
</tool_restrictions>

<objective>
Debug a specific issue using systematic 4-phase investigation.
Dispatches a debugger agent in isolated context.
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/debug.md
</execution_context>

<process>
Execute the debug workflow from the referenced file. The bug description is provided as the command argument.
</process>
