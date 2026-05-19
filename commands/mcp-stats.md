---
name: mcp-stats
description: Per-tool MCP stats — calls, error rate, p50/p95/p99 durations from .devt/memory/_mcp-trace.jsonl. Flags --since, --tool, --top=N --by=calls|duration|errors, --prune-older-than.
---

<tool_restrictions>
This workflow uses: Bash
</tool_restrictions>

<objective>
Surface aggregated statistics from the devt-memory MCP trace log. Identifies slow tools
(durations), unreliable tools (error rates), and infrequently-used tools (call counts).
Privacy-safe: the underlying trace records contain only sizes and sha256 fingerprints,
never tool arguments or results.
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/mcp-stats.md
</execution_context>

<process>
**Mandatory first action**: read `${CLAUDE_PLUGIN_ROOT}/workflows/mcp-stats.md` via the Read tool before any other action. The `@`-reference above may not be inlined by every harness; the explicit Read guarantees the workflow body is in context.

Then execute every `<step>` block in the file in order. Do NOT skip `context_init`. Do NOT dispatch any `Task(subagent_type="devt:*", ...)` without the workflow's `<scope_trust>`, `<scope_hint>`, and `<memory_signal>` blocks injected into the prompt — raw dispatches bypass the Graphify-first protocol and produce grep-quality output.

Execute the mcp-stats workflow from the referenced file end-to-end.
</process>
