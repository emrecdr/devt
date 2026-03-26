---
name: arch-health
description: Architecture health scan — detect violations, coupling issues, and structural drift
---

<tool_restrictions>
This workflow uses: Bash, Read, Glob, Grep, Agent
</tool_restrictions>

<objective>
Scan the codebase for architecture health: layer violations, coupling issues, circular dependencies, structural drift from established patterns, and convention inconsistencies.
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/arch-health-scan.md
</execution_context>

<process>
Execute the architecture health scan workflow from the referenced file end-to-end.
</process>
