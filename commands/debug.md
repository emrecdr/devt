---
name: debug
description: Systematic debugging with 4-phase investigation — root cause first, then fix. Isolates in fresh context to preserve your main session.
---

<tool_restrictions>
This workflow uses: Read, Write, Edit, Bash, Glob, Grep, Agent
</tool_restrictions>

<objective>
Debug a specific issue using systematic 4-phase investigation.
Dispatches a debugger agent in isolated context.
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/debug.md
</execution_context>

<process>
**Mandatory first action**: read `${CLAUDE_PLUGIN_ROOT}/workflows/debug.md` via the Read tool before any other action. The `@`-reference above may not be inlined by every harness; the explicit Read guarantees the workflow body is in context.

Then execute every `<step>` block in the file in order. Do NOT skip `context_init`. Do NOT dispatch any `Task(subagent_type="devt:*", ...)` without the workflow's `<scope_trust>`, `<scope_hint>`, and `<memory_signal>` blocks injected into the prompt — raw dispatches bypass the Graphify-first protocol and produce grep-quality output.

Execute the debug workflow from the referenced file. The bug description is provided as the command argument.
</process>
