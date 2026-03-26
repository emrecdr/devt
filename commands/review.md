---
name: review
description: Standalone code review — READ-ONLY analysis with findings and recommendations
---

<tool_restrictions>
This workflow uses: Bash, Read, Glob, Grep, Agent
</tool_restrictions>

<objective>
Perform a standalone code review of the current changes or specified files. This is a read-only operation — no edits or writes are made.
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/code-review.md
</execution_context>

<process>
Execute the code review workflow from the referenced file end-to-end. Reports findings with severity, location, and recommendations.
</process>
