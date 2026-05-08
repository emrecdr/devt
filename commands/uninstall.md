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
Execute the uninstall workflow from the referenced file end-to-end. The workflow asks the user to pick the destructiveness level (reinit / project-reset / full-reset / plugin-uninstall) via AskUserQuestion, confirms before any destructive operation, and reports what was changed.
</process>
