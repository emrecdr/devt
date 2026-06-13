---
name: retro
description: Extract lessons learned from the current session into persistent memory
user-invocable: false
---

<tool_restrictions>
This workflow uses: Bash, Read, Write, Agent
</tool_restrictions>

<objective>
Analyze the current session to extract lessons learned, patterns discovered, and decisions made. Persist valuable insights to project memory for future sessions.
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/lesson-extraction.md
</execution_context>

<process>
**Mandatory first action**: read `${CLAUDE_PLUGIN_ROOT}/workflows/lesson-extraction.md` via the Read tool before any other action. The `@`-reference above may not be inlined by every harness; the explicit Read guarantees the workflow body is in context.

Then execute every `<step>` block in the file in order. Do NOT skip `context_init`. Do NOT dispatch any `Task(subagent_type="devt:*", ...)` without the workflow's `<scope_trust>`, `<scope_hint>`, and `<memory_signal>` blocks injected into the prompt — raw dispatches bypass the Graphify-first protocol and produce grep-quality output.

Execute the lesson extraction workflow from the referenced file end-to-end.
</process>
