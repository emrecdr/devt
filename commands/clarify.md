---
name: clarify
description: Discuss implementation choices and capture decisions before coding — identifies gray areas and prevents wrong assumptions
argument-hint: "<task description> [--assumptions]"
user-invocable: false
---

<tool_restrictions>
This workflow uses: Read, Glob, Grep, AskUserQuestion
</tool_restrictions>

<objective>
Analyze a task for ambiguity, discuss choices with the user, and capture decisions before implementation begins.
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/clarify-task.md
</execution_context>

<process>
**Mandatory first action**: read `${CLAUDE_PLUGIN_ROOT}/workflows/clarify-task.md` via the Read tool before any other action. The `@`-reference above may not be inlined by every harness; the explicit Read guarantees the workflow body is in context.

Then execute every `<step>` block in the file in order. Do NOT skip `context_init`. Do NOT dispatch any `Task(subagent_type="devt:*", ...)` without the workflow's `<scope_trust>`, `<scope_hint>`, and `<memory_signal>` blocks injected into the prompt — raw dispatches bypass the Graphify-first protocol and produce grep-quality output.

Execute the clarify-task workflow from the referenced file. The task description is provided as the command argument.

If the argument contains `--assumptions`, use assumptions mode (codebase-first, fewer questions).
Otherwise, use the default interview mode (structured questioning).
</process>
