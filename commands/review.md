---
name: review
description: Standalone code review — READ-ONLY analysis with findings and recommendations
---

<tool_restrictions>
This workflow uses: Bash, Read, Glob, Grep, Agent
</tool_restrictions>

<objective>
Perform a standalone code review of the current changes or specified files. This is a read-only operation — no edits or writes are made.
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/code-review.md
</execution_context>

<process>
**Mandatory first action**: read `${CLAUDE_PLUGIN_ROOT}/workflows/code-review.md` via the Read tool before any other action. The `@`-reference above may not be inlined by every harness; the explicit Read guarantees the workflow body is in context.

Then execute every `<step>` block in the file in order. Do NOT skip `context_init` — it generates the Graphify impact plan and writes `.devt/state/graphify-impact-plan.json` + `graph-impact.md`. Do NOT dispatch any `Task(subagent_type="devt:*", ...)` without the workflow's `<scope_trust>`, `<scope_hint>`, and `<memory_signal>` blocks injected into the prompt — raw dispatches bypass the Graphify-first protocol and produce grep-quality output.

Reports findings with severity, location, and recommendations.
</process>
