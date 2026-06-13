---
name: docs
description: Update project documentation to reflect recent code changes — standalone, no active workflow required
user-invocable: false
---

<tool_restrictions>
This workflow uses: Bash, Read, Write, Agent
</tool_restrictions>

<objective>
Dispatch the docs-writer agent to update project documentation in response to recent changes. Standalone — runs whether or not a `/devt:workflow` is active. Use after merging a feature, after a refactor, or whenever the codebase has drifted from its docs.
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/docs-extraction.md
</execution_context>

<process>
**Mandatory first action**: read `${CLAUDE_PLUGIN_ROOT}/workflows/docs-extraction.md` via the Read tool before any other action. The `@`-reference above may not be inlined by every harness; the explicit Read guarantees the workflow body is in context.

Then execute every `<step>` block in the file in order. Do NOT skip `context_init`.

Execute the docs extraction workflow from the referenced file end-to-end.
</process>
