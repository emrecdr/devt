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

## Memory integration

This command does not auto-fire `/devt:preflight` (it's a meta workflow, not a dev workflow). However:
- If `.devt/state/preflight-brief.md` exists from a prior workflow, this command may surface it as context (e.g., `/devt:forensics` reads it when investigating failures; `/devt:thread` references it for cross-session work).
- For ADR/Concept/Flow lookups, use `node bin/devt-tools.cjs memory query <terms>` or the MCP `query_fts` tool.
- For REJ tombstone awareness, `node bin/devt-tools.cjs memory rejected-keywords` enumerates active suppressions.

See `docs/MEMORY.md` for the full surface.
