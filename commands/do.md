---
name: do
description: Route freeform text to the right devt command — describe what you want and it picks the command
argument-hint: "<what you want to do>"
---

<objective>
Analyze freeform natural language and dispatch to the most appropriate devt command.
Acts as a smart dispatcher — never does work itself.
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/do.md
</execution_context>

<process>
Execute the do workflow from the referenced file. Route user intent to the best devt command.
</process>

## Memory integration (v0.20.0+)

This command does not auto-fire `/devt:preflight` (it's a meta workflow, not a dev workflow). However:
- If `.devt/state/preflight-brief.md` exists from a prior workflow, this command may surface it as context (e.g., `/devt:forensics` reads it when investigating failures; `/devt:thread` references it for cross-session work).
- For ADR/Concept/Flow lookups, use `node bin/devt-tools.cjs memory query <terms>` or the MCP `query_fts` tool.
- For REJ tombstone awareness, `node bin/devt-tools.cjs memory rejected-keywords` enumerates active suppressions.

See `docs/MEMORY.md` for the full surface.
