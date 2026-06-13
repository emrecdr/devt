---
name: health
description: Diagnose devt plugin health — checks .devt/state/, .devt/rules/, config, and hook status. Use when workflows fail unexpectedly or after interrupted sessions.
user-invocable: false
---

<tool_restrictions>
This workflow uses: Read, Bash, Glob
</tool_restrictions>

<objective>
Run diagnostic checks on the devt plugin configuration and project state.
Report issues with error codes and suggest fixes. Optionally auto-repair.
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/health.md
</execution_context>

<process>
**Mandatory first action**: read `${CLAUDE_PLUGIN_ROOT}/workflows/health.md` via the Read tool before any other action. The `@`-reference above may not be inlined by every harness; the explicit Read guarantees the workflow body is in context.

Then execute every `<step>` block in the file in order. Do NOT skip `context_init`. Do NOT dispatch any `Task(subagent_type="devt:*", ...)` without the workflow's `<scope_trust>`, `<scope_hint>`, and `<memory_signal>` blocks injected into the prompt — raw dispatches bypass the Graphify-first protocol and produce grep-quality output.

Execute the health workflow from the referenced file.
</process>
