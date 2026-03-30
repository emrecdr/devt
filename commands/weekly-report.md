---
name: weekly-report
description: Generate a weekly development activity report from git history
---

<tool_restrictions>
This workflow uses: Bash, Read, Write
</tool_restrictions>

<objective>
Generate a weekly development report summarizing commits, contributors, and activity patterns from the git log.
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/weekly-report.md
</execution_context>

<process>
Execute the weekly report workflow from the referenced file end-to-end.
</process>
