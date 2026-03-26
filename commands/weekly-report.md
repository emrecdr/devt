---
name: weekly-report
description: Generate a weekly contribution report from git history and session logs
---

<tool_restrictions>
This workflow uses: Bash, Read, Write, Agent
</tool_restrictions>

<objective>
Generate a structured weekly contribution report summarizing commits, features delivered, bugs fixed, and technical improvements across the past week.
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/weekly-report.md
</execution_context>

<process>
Execute the weekly report workflow from the referenced file end-to-end.
</process>
