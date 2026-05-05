---
name: thread
description: Persistent context threads for cross-session work — create, list, or resume investigation threads that survive session boundaries. Use for multi-session debugging, research, or explorations.
---

<tool_restrictions>
This workflow uses: Read, Write, Bash, Glob
</tool_restrictions>

<objective>
Manage lightweight context threads that persist across sessions.
Threads are lighter than full workflow state — just goal, context, and next steps.
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/thread.md
</execution_context>

<process>
Execute the thread workflow.
Subcommands: /devt:thread create <title>, /devt:thread list, /devt:thread resume <N>
</process>

## Memory integration (v0.20.0+)

This command does not auto-fire `/devt:preflight` (it's a meta workflow, not a dev workflow). However:
- If `.devt/state/preflight-brief.md` exists from a prior workflow, this command may surface it as context (e.g., `/devt:forensics` reads it when investigating failures; `/devt:thread` references it for cross-session work).
- For ADR/Concept/Flow lookups, use `node bin/devt-tools.cjs memory query <terms>` or the MCP `query_fts` tool.
- For REJ tombstone awareness, `node bin/devt-tools.cjs memory rejected-keywords` enumerates active suppressions.

See `docs/MEMORY.md` for the full surface.
