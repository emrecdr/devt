---
name: specify
description: Create a detailed PRD through systematic interview and codebase analysis — generates structured specifications with decisions, API design, test scenarios, and task breakdown. Use when the user says 'specify', 'write a spec', 'create a PRD', 'requirements for', 'what should we build', 'define the feature', 'before we start building', or describes a feature idea that needs scoping before implementation.
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
