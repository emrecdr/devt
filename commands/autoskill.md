---
name: autoskill
description: Analyze the current session for patterns and propose skill/agent improvements
---

<tool_restrictions>
This workflow uses: Bash, Read, Write, Edit, Agent, Glob, Grep
</tool_restrictions>

<objective>
Scan the current session for repeated corrections, missing capabilities, and workflow friction. Propose targeted improvements to devt skills and agents with evidence (3+ instances required).
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/autoskill.md
</execution_context>

<process>
Execute the autoskill workflow from the referenced file end-to-end.
</process>
