---
name: health
description: Diagnose devt plugin health — checks .devt/state/ integrity, .devt/rules/ completeness, config validation, and hook status. Use when workflows fail unexpectedly or after interrupted sessions.
---

<tool_restrictions>
This workflow uses: Read, Bash, Glob
</tool_restrictions>

<objective>
Run diagnostic checks on the devt plugin configuration and project state.
Report issues with error codes and suggest fixes. Optionally auto-repair.
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/health.md
</execution_context>

<process>
Execute the health workflow from the referenced file.
</process>
