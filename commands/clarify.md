---
name: clarify
description: Discuss implementation choices and capture decisions before coding — identifies gray areas and prevents wrong assumptions
---

<tool_restrictions>
This workflow uses: Read, Glob, Grep, AskUserQuestion
</tool_restrictions>

<objective>
Analyze a task for ambiguity, discuss choices with the user, and capture decisions before implementation begins.
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/clarify-task.md
</execution_context>

<process>
Execute the clarify-task workflow from the referenced file. The task description is provided as the command argument.
</process>
