---
name: tokens
description: Token usage telemetry from Claude Code session logs — per-session and aggregate cache-hit rate. Supports --sessions=N, --since, --baseline, --compare for measuring optimizations.
user-invocable: false
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
**Mandatory first action**: read `${CLAUDE_PLUGIN_ROOT}/workflows/tokens.md` via the Read tool before any other action. The `@`-reference above may not be inlined by every harness; the explicit Read guarantees the workflow body is in context.

Then execute every `<step>` block in the file in order. Do NOT skip `context_init`. Do NOT dispatch any `Task(subagent_type="devt:*", ...)` without the workflow's `<scope_trust>`, `<scope_hint>`, and `<memory_signal>` blocks injected into the prompt — raw dispatches bypass the Graphify-first protocol and produce grep-quality output.

Execute the tokens workflow from the referenced file end-to-end.
</process>
