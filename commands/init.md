---
name: init
description: Interactive project setup wizard that configures devt for a new or existing project
---

<tool_restrictions>
This workflow uses: Bash, Read, Write, AskUserQuestion
</tool_restrictions>

<objective>
Run the interactive project setup wizard to configure devt for the current project. Detects project type, sets up configuration files, and establishes conventions.
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/project-init.md
</execution_context>

<process>
Execute the project initialization workflow from the referenced file end-to-end.
</process>
