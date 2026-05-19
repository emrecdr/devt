---
name: quality
description: Run quality gates — lint, typecheck, and tests
---

<tool_restrictions>
This workflow uses: Bash, Read, Glob, Grep
</tool_restrictions>

<objective>
Run the project's quality gates (linting, type checking, and test suites) and report results with actionable summaries.
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/quality-gates.md
</execution_context>

<process>
**Mandatory first action**: read `${CLAUDE_PLUGIN_ROOT}/workflows/quality-gates.md` via the Read tool before any other action. The `@`-reference above may not be inlined by every harness; the explicit Read guarantees the workflow body is in context.

Then execute every `<step>` block in the file in order. Do NOT skip `context_init`. Do NOT dispatch any `Task(subagent_type="devt:*", ...)` without the workflow's `<scope_trust>`, `<scope_hint>`, and `<memory_signal>` blocks injected into the prompt — raw dispatches bypass the Graphify-first protocol and produce grep-quality output.

Execute the quality gates workflow from the referenced file end-to-end.
</process>
