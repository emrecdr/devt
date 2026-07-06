---
name: plan
description: Create a detailed implementation plan before coding — analyzes the task, identifies files, breaks into steps, validates the approach. Use before /devt:workflow for complex tasks.
---

<tool_restrictions>
This workflow uses: Read, Write, Glob, Grep, Bash, Agent, AskUserQuestion
</tool_restrictions>

<objective>
Create a validated implementation plan that breaks the task into concrete, verifiable steps.
</objective>

<process>
**Mandatory first action**: read `${CLAUDE_PLUGIN_ROOT}/workflows/create-plan.md` via the Read tool before any other action. The workflow body is NOT preloaded — the explicit Read is the only load path.

Then execute every `<step>` block in the file in order. Do NOT skip `context_init`. Do NOT dispatch any `Task(subagent_type="devt:*", ...)` without the workflow's `<scope_trust>`, `<scope_hint>`, and `<memory_signal>` blocks injected into the prompt — raw dispatches bypass the Graphify-first protocol and produce grep-quality output.

Execute the planning workflow from the referenced file. The task description is provided as the command argument.

**Elicit task if empty.** If `$ARGUMENTS` is empty, ask the user in plain prose: *"What task are we planning?"* Wait for the response and use it as the task. Do NOT proceed without a task — planning blind produces noise.
</process>
