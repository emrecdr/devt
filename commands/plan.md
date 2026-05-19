---
name: plan
description: Create a detailed implementation plan before coding — analyzes the task, identifies files, breaks into steps, validates the approach. Use before /devt:workflow for complex tasks.
---

<tool_restrictions>
This workflow uses: Read, Write, Glob, Grep, Bash, Agent, AskUserQuestion
</tool_restrictions>

<objective>
Create a validated implementation plan that breaks the task into concrete, verifiable steps.
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/create-plan.md
</execution_context>

<process>
**Mandatory first action**: read `${CLAUDE_PLUGIN_ROOT}/workflows/create-plan.md` via the Read tool before any other action. The `@`-reference above may not be inlined by every harness; the explicit Read guarantees the workflow body is in context.

Then execute every `<step>` block in the file in order. Do NOT skip `context_init`. Do NOT dispatch any `Task(subagent_type="devt:*", ...)` without the workflow's `<scope_trust>`, `<scope_hint>`, and `<memory_signal>` blocks injected into the prompt — raw dispatches bypass the Graphify-first protocol and produce grep-quality output.

Execute the planning workflow from the referenced file. The task description is provided as the command argument.
</process>
