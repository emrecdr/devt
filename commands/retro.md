---
name: retro
description: Extract lessons learned from the current session into persistent memory
---

<tool_restrictions>
This workflow uses: Bash, Read, Write, Agent
</tool_restrictions>

<objective>
Analyze the current session to extract lessons learned, patterns discovered, and decisions made. Persist valuable insights to project memory for future sessions.
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/lesson-extraction.md
</execution_context>

<process>
Execute the lesson extraction workflow from the referenced file end-to-end.
</process>
