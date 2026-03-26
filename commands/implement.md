---
name: implement
description: Quick implementation — skip docs and retro, go straight to code and tests
---

<tool_restrictions>
This workflow uses: Bash, Read, Write, Edit, Agent, Glob, Grep
</tool_restrictions>

<objective>
Perform a focused implementation cycle for a given task: scan, implement, and test — without documentation updates or retrospective extraction.
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/quick-implement.md
</execution_context>

<process>
Execute the quick implementation workflow from the referenced file end-to-end. The task description is provided as the command argument.
</process>
