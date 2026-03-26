---
name: research
description: Research implementation approaches before planning — investigates codebase patterns, identifies pitfalls, recommends strategy. Use before /devt:plan for unfamiliar domains or complex tasks.
---

<tool_restrictions>
This workflow uses: Read, Bash, Glob, Grep, Agent
</tool_restrictions>

<objective>
Investigate how to implement a task before writing any code or creating a plan.
Produces a research report with recommended approach, pitfalls, and reusable patterns.
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/research-task.md
</execution_context>

<process>
Execute the research workflow from the referenced file. The task description is provided as the command argument.
</process>
