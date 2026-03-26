---
name: workflow
description: Full development pipeline — scan, implement, test, review, docs, retro
---

<tool_restrictions>
This workflow uses: Bash, Read, Write, Edit, Agent, Glob, Grep
</tool_restrictions>

<objective>
Execute the complete development workflow for a given task: architecture scan, implementation, testing, code review, documentation updates, and retrospective extraction.
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/dev-workflow.md
</execution_context>

<process>
Execute the full development workflow from the referenced file end-to-end. The task description is provided as the command argument.
</process>
