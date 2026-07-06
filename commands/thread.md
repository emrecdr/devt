---
name: thread
description: Persistent context threads for cross-session work — create, list, or resume investigations that survive session boundaries. Use for multi-session debugging or research.
user-invocable: false
---

<tool_restrictions>
This workflow uses: Read, Write, Bash, Glob
</tool_restrictions>

<objective>
Manage lightweight context threads that persist across sessions.
Threads are lighter than full workflow state — just goal, context, and next steps.
</objective>

<process>
**Mandatory first action**: read `${CLAUDE_PLUGIN_ROOT}/workflows/thread.md` via the Read tool before any other action. The workflow body is NOT preloaded — the explicit Read is the only load path.

Then execute every `<step>` block in the file in order. Do NOT skip `context_init`. Do NOT dispatch any `Task(subagent_type="devt:*", ...)` without the workflow's `<scope_trust>`, `<scope_hint>`, and `<memory_signal>` blocks injected into the prompt — raw dispatches bypass the Graphify-first protocol and produce grep-quality output.

Execute the thread workflow.
Subcommands: /devt:thread create <title>, /devt:thread list, /devt:thread resume <N>
</process>

## Memory integration

This command does not auto-fire `/devt:preflight` (it's a meta workflow, not a dev workflow). However:
- If `.devt/state/preflight-brief.md` exists from a prior workflow, this command may surface it as context (e.g., `/devt:debug --mode=forensics` reads it when investigating failures; `/devt:thread` references it for cross-session work).
- For ADR/Concept/Flow lookups, use `node bin/devt-tools.cjs memory query <terms>` or the MCP `query_fts` tool.
- For REJ tombstone awareness, `node bin/devt-tools.cjs memory rejected-keywords` enumerates active suppressions.

See `docs/MEMORY.md` for the full surface.
