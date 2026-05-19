---
name: pause
description: Pause current workflow and create a structured handoff for session resumption — captures progress, decisions, and context notes
---

<tool_restrictions>
This workflow uses: Read, Write, Bash
</tool_restrictions>

<objective>
Create a structured handoff file (.devt/state/handoff.json + continue-here.md) that enables
rich session resumption via /devt:status.
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/pause-work.md
</execution_context>

<process>
**Mandatory first action**: read `${CLAUDE_PLUGIN_ROOT}/workflows/pause-work.md` via the Read tool before any other action. The `@`-reference above may not be inlined by every harness; the explicit Read guarantees the workflow body is in context.

Then execute every `<step>` block in the file in order. Do NOT skip `context_init`. Do NOT dispatch any `Task(subagent_type="devt:*", ...)` without the workflow's `<scope_trust>`, `<scope_hint>`, and `<memory_signal>` blocks injected into the prompt — raw dispatches bypass the Graphify-first protocol and produce grep-quality output.

Execute the pause-work workflow from the referenced file.
</process>
