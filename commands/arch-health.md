---
name: arch-health
description: Architecture health scan — detect violations, coupling issues, and structural drift. Supports delta mode (new issues only), baseline management, and interactive triage.
argument-hint: "[--all] [--update-baseline] [--triage]"
---

<tool_restrictions>
This workflow uses: Bash, Read, Glob, Grep, Agent, AskUserQuestion
</tool_restrictions>

<objective>
Scan the codebase for architecture health: layer violations, coupling issues, circular dependencies, structural drift from established patterns, and convention inconsistencies. By default, shows only NEW findings since last scan (delta mode).
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/arch-health-scan.md
</execution_context>

<process>
**Mandatory first action**: read `${CLAUDE_PLUGIN_ROOT}/workflows/arch-health-scan.md` via the Read tool before any other action. The `@`-reference above may not be inlined by every harness; the explicit Read guarantees the workflow body is in context.

Then execute every `<step>` block in the file in order. Do NOT skip `context_init`. Do NOT dispatch any `Task(subagent_type="devt:*", ...)` without the workflow's `<scope_trust>`, `<scope_hint>`, and `<memory_signal>` blocks injected into the prompt — raw dispatches bypass the Graphify-first protocol and produce grep-quality output.

Execute the architecture health scan workflow from the referenced file end-to-end.

Modes:
- Default: delta mode — only new issues since last baseline
- `--all`: show all findings regardless of baseline
- `--update-baseline`: save current state as baseline, then stop
- `--triage`: interactively classify each untriaged finding (accept/dismiss/defer)
</process>
