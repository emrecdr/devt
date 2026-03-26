---
name: autoskill
description: Propose skill and agent updates based on patterns observed in recent sessions
---

<tool_restrictions>
This workflow uses: Bash, Read, Write
</tool_restrictions>

<objective>
Analyze recent session patterns, repeated workflows, and manual interventions to propose updates to skills, agents, and automation rules within the devt plugin.
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/autoskill.md
</execution_context>

<process>
Execute the autoskill workflow from the referenced file end-to-end. Identifies recurring patterns and proposes concrete skill/agent improvements.
</process>
