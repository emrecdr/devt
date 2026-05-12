---
name: weekly-report
description: Generate a weekly development activity report from git history
---

<tool_restrictions>
This workflow uses: Bash, Read, Write
</tool_restrictions>

<objective>
Generate a weekly development report summarizing commits, contributors, and activity patterns from the git log.
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/weekly-report.md
</execution_context>

<process>
Execute the weekly report workflow from the referenced file end-to-end.
</process>

## Memory integration

This command does not auto-fire `/devt:preflight` (it's a meta workflow, not a dev workflow). However:
- If `.devt/state/preflight-brief.md` exists from a prior workflow, this command may surface it as context (e.g., `/devt:forensics` reads it when investigating failures; `/devt:thread` references it for cross-session work).
- For ADR/Concept/Flow lookups, use `node bin/devt-tools.cjs memory query <terms>` or the MCP `query_fts` tool.
- For REJ tombstone awareness, `node bin/devt-tools.cjs memory rejected-keywords` enumerates active suppressions.

See `docs/MEMORY.md` for the full surface.
