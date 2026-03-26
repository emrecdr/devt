---
name: plan
description: Create a detailed implementation plan before coding — analyzes the task, identifies files to change, breaks into steps, and validates the approach. Use before /devt:workflow for complex tasks.
---

<tool_restrictions>
This workflow uses: Read, Write, Glob, Grep, Bash, Agent, AskUserQuestion
</tool_restrictions>

<objective>
Create a validated implementation plan that breaks the task into concrete, verifiable steps.
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/create-plan.md
</execution_context>

<process>
Execute the planning workflow from the referenced file. The task description is provided as the command argument.
</process>
