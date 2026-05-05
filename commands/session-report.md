---
name: session-report
description: Generate a session summary — work done, commits, decisions, outcomes
---

<objective>
Generate a post-session report capturing what was accomplished, files changed, decisions made, and outcomes achieved.
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/session-report.md
</execution_context>

<process>
Execute the session report workflow from the referenced file.
</process>

## Memory integration (v0.20.0+)

This command does not auto-fire `/devt:preflight` (it's a meta workflow, not a dev workflow). However:
- If `.devt/state/preflight-brief.md` exists from a prior workflow, this command may surface it as context (e.g., `/devt:forensics` reads it when investigating failures; `/devt:thread` references it for cross-session work).
- For ADR/Concept/Flow lookups, use `node bin/devt-tools.cjs memory query <terms>` or the MCP `query_fts` tool.
- For REJ tombstone awareness, `node bin/devt-tools.cjs memory rejected-keywords` enumerates active suppressions.

See `docs/MEMORY.md` for the full surface.
