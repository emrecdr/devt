---
name: uninstall
description: Reset or uninstall devt — pick between reinit (keep memory), project reset, full clean, or plugin uninstall
---

<tool_restrictions>
This workflow uses: Bash, Read, AskUserQuestion
</tool_restrictions>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/uninstall.md
</execution_context>

<process>
**Mandatory first action**: read `${CLAUDE_PLUGIN_ROOT}/workflows/uninstall.md` via the Read tool before any other action. The `@`-reference above may not be inlined by every harness; the explicit Read guarantees the workflow body is in context.

Then execute every `<step>` block in the file in order. Do NOT skip `context_init`. Do NOT dispatch any `Task(subagent_type="devt:*", ...)` without the workflow's `<scope_trust>`, `<scope_hint>`, and `<memory_signal>` blocks injected into the prompt — raw dispatches bypass the Graphify-first protocol and produce grep-quality output.

Execute the uninstall workflow from the referenced file end-to-end. The workflow asks the user to pick the destructiveness level (reinit / project-reset / full-reset / plugin-uninstall) via AskUserQuestion, confirms before any destructive operation, and reports what was changed.
</process>
