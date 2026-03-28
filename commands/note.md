---
name: note
description: Zero-friction idea capture — quickly save a thought, then optionally promote it to a task later. Use when you have an idea mid-workflow that shouldn't derail current work.
---

<tool_restrictions>
This workflow uses: Read, Write, Bash
</tool_restrictions>

<objective>
Capture an idea or observation instantly without disrupting the current workflow.
Notes can be listed or promoted to tasks later.
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/note.md
</execution_context>

<process>
Execute the note workflow. The note text is provided as the command argument.
Subcommands: /devt:note <text> (append), /devt:note list, /devt:note promote <N>
</process>
