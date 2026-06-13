---
name: autoskill
description: Analyze the current session for patterns and propose skill/agent improvements
user-invocable: false
---

<tool_restrictions>
This workflow uses: Bash, Read, Write, Edit, Agent, Glob, Grep
</tool_restrictions>

<objective>
Scan the current session for repeated corrections, missing capabilities, and workflow friction. Propose targeted improvements to devt skills and agents with evidence (3+ instances required).
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/autoskill.md
</execution_context>

<process>
**Mandatory first action**: read `${CLAUDE_PLUGIN_ROOT}/workflows/autoskill.md` via the Read tool before any other action. The `@`-reference above may not be inlined by every harness; the explicit Read guarantees the workflow body is in context.

Then execute every `<step>` block in the file in order. Do NOT skip `context_init`. Do NOT dispatch any `Task(subagent_type="devt:*", ...)` without the workflow's `<scope_trust>`, `<scope_hint>`, and `<memory_signal>` blocks injected into the prompt — raw dispatches bypass the Graphify-first protocol and produce grep-quality output.

Execute the autoskill workflow from the referenced file end-to-end.
</process>
