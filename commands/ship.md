---
name: ship
description: Create a pull request with auto-generated description from workflow artifacts — reads impl-summary, test-summary, and review verdict from .devt/state/
---

<tool_restrictions>
This workflow uses: Bash, Read, Glob, Grep
</tool_restrictions>

<objective>
Create a pull request with a rich, auto-generated description composed from the completed workflow's .devt/state/ artifacts (impl-summary.md, test-summary.md, review.md, decisions.md).
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/ship.md
</execution_context>

<process>
Execute the ship workflow from the referenced file end-to-end. Reads workflow artifacts, generates PR body, pushes branch, and creates the PR via gh CLI.
</process>
