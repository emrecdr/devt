---
name: specify
description: Create a detailed PRD through systematic interview + codebase analysis. Use when scoping a feature before implementation — "specify", "write a spec", "requirements for X".
---

<tool_restrictions>
This workflow uses: Read, Write, Glob, Grep, Bash, AskUserQuestion
</tool_restrictions>

<objective>
Generate a comprehensive Product Requirements Document by interviewing the user and analyzing
the existing codebase. Produces structured PRDs that feed into /devt:plan and /devt:workflow.
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/specify.md
</execution_context>

<process>
**Mandatory first action**: read `${CLAUDE_PLUGIN_ROOT}/workflows/specify.md` via the Read tool before any other action. The `@`-reference above may not be inlined by every harness; the explicit Read guarantees the workflow body is in context.

Then execute every `<step>` block in the file in order. Do NOT skip `context_init`. Do NOT dispatch any `Task(subagent_type="devt:*", ...)` without the workflow's `<scope_trust>`, `<scope_hint>`, and `<memory_signal>` blocks injected into the prompt — raw dispatches bypass the Graphify-first protocol and produce grep-quality output.

Execute the specify workflow from the referenced file. The feature idea is provided as the command argument.
</process>
