---
name: forensics
description: Post-mortem investigation of failed or stuck workflows — analyzes artifacts, state, and git history to diagnose what went wrong
---

<tool_restrictions>
This workflow uses: Read, Bash, Glob, Grep
</tool_restrictions>

<objective>
Investigate a failed or stuck devt workflow to determine what went wrong, why, and what to do next.
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/forensics.md
</execution_context>

<process>
Execute the forensics workflow from the referenced file. No arguments required — the investigation reads existing state and artifacts.
</process>
