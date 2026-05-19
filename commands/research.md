---
name: research
description: Research implementation approaches before planning — codebase patterns, pitfalls, recommended strategy. Use before /devt:plan for unfamiliar domains or complex tasks.
---

<tool_restrictions>
This workflow uses: Read, Bash, Glob, Grep, Agent
</tool_restrictions>

<objective>
Investigate how to implement a task before writing any code or creating a plan.
Produces a research report with recommended approach, pitfalls, and reusable patterns.
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/research-task.md
</execution_context>

<process>
**Mandatory first action**: read `${CLAUDE_PLUGIN_ROOT}/workflows/research-task.md` via the Read tool before any other action. The `@`-reference above may not be inlined by every harness; the explicit Read guarantees the workflow body is in context.

Then execute every `<step>` block in the file in order. Do NOT skip `context_init`. Do NOT dispatch any `Task(subagent_type="devt:*", ...)` without the workflow's `<scope_trust>`, `<scope_hint>`, and `<memory_signal>` blocks injected into the prompt — raw dispatches bypass the Graphify-first protocol and produce grep-quality output.

Execute the research workflow from the referenced file. The task description is provided as the command argument.
</process>
