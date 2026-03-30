---
name: do
description: Route freeform text to the right devt command — describe what you want and it picks the command
argument-hint: "<what you want to do>"
---

<objective>
Analyze freeform natural language and dispatch to the most appropriate devt command.
Acts as a smart dispatcher — never does work itself.
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/do.md
</execution_context>

<process>
Execute the do workflow from the referenced file. Route user intent to the best devt command.
</process>
