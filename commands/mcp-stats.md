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
Execute the mcp-stats workflow from the referenced file end-to-end.
</process>
