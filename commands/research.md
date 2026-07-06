---
name: research
description: Research implementation approaches before planning — codebase patterns, pitfalls, recommended strategy. Use before /devt:plan for unfamiliar domains or complex tasks.
---

<tool_restrictions>
This workflow uses: Read, Bash, Glob, Grep, Agent
</tool_restrictions>

<objective>
Investigate how to implement a task before writing any code or creating a plan.
Produces a research report with recommended approach, pitfalls, and reusable patterns.
</objective>

<process>
**Mandatory first action**: read `${CLAUDE_PLUGIN_ROOT}/workflows/research-task.md` via the Read tool before any other action. The workflow body is NOT preloaded — the explicit Read is the only load path.

Then execute every `<step>` block in the file in order. Do NOT skip `context_init`. Do NOT dispatch any `Task(subagent_type="devt:*", ...)` without the workflow's `<scope_trust>`, `<scope_hint>`, and `<memory_signal>` blocks injected into the prompt — raw dispatches bypass the Graphify-first protocol and produce grep-quality output.

Execute the research workflow from the referenced file. The task description is provided as the command argument.

**Elicit topic if empty.** If `$ARGUMENTS` is empty, ask the user in plain prose: *"What topic should I research? (e.g., a feature area, integration pattern, or specific subsystem)"* Wait for the response and use it as the research topic. Do NOT proceed without a topic.
</process>
