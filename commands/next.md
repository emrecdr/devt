---
name: next
description: Auto-detect where you are and run the next logical step — reads workflow state and acts
---

<tool_restrictions>
This workflow uses: Bash, Read, Glob, Grep, Agent, Write, Edit, AskUserQuestion
</tool_restrictions>

<objective>
Read the current workflow state, determine the next logical action, and execute it. The user never needs to remember which command comes next.
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/next.md
</execution_context>

<process>
Execute the next workflow from the referenced file. No arguments needed — it reads state to determine what to do.
</process>
