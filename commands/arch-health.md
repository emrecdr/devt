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
Execute the architecture health scan workflow from the referenced file end-to-end.

Modes:
- Default: delta mode — only new issues since last baseline
- `--all`: show all findings regardless of baseline
- `--update-baseline`: save current state as baseline, then stop
- `--triage`: interactively classify each untriaged finding (accept/dismiss/defer)
</process>
