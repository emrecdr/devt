---
name: tokens
description: Token usage telemetry from Claude Code session logs — per-session and aggregate cache-hit rate. Supports --sessions=N, --since, --baseline, --compare for measuring optimizations.
---

<tool_restrictions>
This workflow uses: Bash
</tool_restrictions>

<objective>
Surface token-usage telemetry parsed from `~/.claude/projects/<slug>/*.jsonl` session logs.
Useful for verifying cache-hit rate, sizing prompt churn, and capturing baselines before/after
optimization changes.
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/tokens.md
</execution_context>

<process>
Execute the tokens workflow from the referenced file end-to-end.
</process>
