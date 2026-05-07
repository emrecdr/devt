---
name: specify
description: Create a detailed PRD through systematic interview + codebase analysis. Use when scoping a feature before implementation — "specify", "write a spec", "requirements for X".
---

<tool_restrictions>
This workflow uses: Read, Write, Glob, Grep, Bash, AskUserQuestion
</tool_restrictions>

<objective>
Generate a comprehensive Product Requirements Document by interviewing the user and analyzing
the existing codebase. Produces structured PRDs that feed into /devt:plan and /devt:workflow.
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/specify.md
</execution_context>

<process>
Execute the specify workflow from the referenced file. The feature idea is provided as the command argument.
</process>
