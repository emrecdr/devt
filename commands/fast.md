---
name: fast
description: Execute a trivial task inline — no subagents, no planning overhead. For tasks touching 3 or fewer files with no architectural impact.
---

<tool_restrictions>
This workflow uses: Bash, Read, Write, Edit, Glob, Grep
</tool_restrictions>

<objective>
Execute a small, well-scoped task directly without subagent dispatch. Validates the task is genuinely trivial via a scope gate before proceeding. If the task is too complex, redirects to /devt:implement.
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/fast.md
</execution_context>

<process>
**Mandatory first action**: read `${CLAUDE_PLUGIN_ROOT}/workflows/fast.md` via the Read tool before any other action. The `@`-reference above may not be inlined by every harness; the explicit Read guarantees the workflow body is in context.

Then execute every `<step>` block in the file in order. Do NOT skip `context_init`. Do NOT dispatch any `Task(subagent_type="devt:*", ...)` without the workflow's `<scope_trust>`, `<scope_hint>`, and `<memory_signal>` blocks injected into the prompt — raw dispatches bypass the Graphify-first protocol and produce grep-quality output.

Execute the fast inline workflow from the referenced file end-to-end. The task description is provided as the command argument.
</process>
