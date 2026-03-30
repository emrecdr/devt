---
name: pause
description: Pause current workflow and create a structured handoff for session resumption — captures progress, decisions, and context notes
---

<tool_restrictions>
This workflow uses: Read, Write, Bash
</tool_restrictions>

<objective>
Create a structured handoff file (.devt/state/handoff.json + continue-here.md) that enables
rich session resumption via /devt:status.
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/pause-work.md
</execution_context>

<process>
Execute the pause-work workflow from the referenced file.
</process>
