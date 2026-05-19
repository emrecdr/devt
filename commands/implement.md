---
name: implement
description: Quick implementation — skip docs and retro, go straight to code and tests
---

<tool_restrictions>
This workflow uses: Bash, Read, Write, Edit, Agent, Glob, Grep
</tool_restrictions>

<objective>
Perform a focused implementation cycle for a given task: scan, implement, and test — without documentation updates or retrospective extraction.
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/quick-implement.md
</execution_context>

<process>
**Mandatory first action**: read `${CLAUDE_PLUGIN_ROOT}/workflows/quick-implement.md` via the Read tool before any other action. The `@`-reference above may not be inlined by every harness; the explicit Read guarantees the workflow body is in context.

Then execute every `<step>` block in the file in order. Do NOT skip `context_init`. Do NOT dispatch any `Task(subagent_type="devt:*", ...)` without the workflow's `<scope_trust>`, `<scope_hint>`, and `<memory_signal>` blocks injected into the prompt — raw dispatches bypass the Graphify-first protocol and produce grep-quality output.

Execute the quick implementation workflow from the referenced file end-to-end. The task description is provided as the command argument.
</process>
