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
Execute the quality gates workflow from the referenced file end-to-end.
</process>
