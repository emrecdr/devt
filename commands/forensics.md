---
name: forensics
description: Post-mortem investigation of failed or stuck workflows — analyzes artifacts, state, and git history to diagnose what went wrong
---

<tool_restrictions>
This workflow uses: Read, Bash, Glob, Grep
</tool_restrictions>

<objective>
Investigate a failed or stuck devt workflow to determine what went wrong, why, and what to do next.
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/forensics.md
</execution_context>

<process>
**Mandatory first action**: read `${CLAUDE_PLUGIN_ROOT}/workflows/forensics.md` via the Read tool before any other action. The `@`-reference above may not be inlined by every harness; the explicit Read guarantees the workflow body is in context.

Then execute every `<step>` block in the file in order. Do NOT skip `context_init`. Do NOT dispatch any `Task(subagent_type="devt:*", ...)` without the workflow's `<scope_trust>`, `<scope_hint>`, and `<memory_signal>` blocks injected into the prompt — raw dispatches bypass the Graphify-first protocol and produce grep-quality output.

Execute the forensics workflow from the referenced file. No arguments required — the investigation reads existing state and artifacts.
</process>

## Memory integration

This command does not auto-fire `/devt:preflight` (it's a meta workflow, not a dev workflow). However:
- If `.devt/state/preflight-brief.md` exists from a prior workflow, this command may surface it as context (e.g., `/devt:forensics` reads it when investigating failures; `/devt:thread` references it for cross-session work).
- For ADR/Concept/Flow lookups, use `node bin/devt-tools.cjs memory query <terms>` or the MCP `query_fts` tool.
- For REJ tombstone awareness, `node bin/devt-tools.cjs memory rejected-keywords` enumerates active suppressions.

See `docs/MEMORY.md` for the full surface.
