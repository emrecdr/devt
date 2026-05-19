---
name: workflow
description: Build, fix, or improve anything — auto-detects complexity and runs the right pipeline
argument-hint: "<task description> [--autonomous] [--to <phase>] [--only <phase>] [--chain]"
---

<tool_restrictions>
This workflow uses: Bash, Read, Write, Edit, Agent, Glob, Grep, AskUserQuestion
</tool_restrictions>

<objective>
Execute the complete development workflow for a given task. Auto-detects complexity tier (TRIVIAL/SIMPLE/STANDARD/COMPLEX) and runs the appropriate pipeline. Handles research, planning, implementation, testing, review, verification, documentation, and retrospective automatically.
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/dev-workflow.md
</execution_context>

<process>
**Mandatory first action**: read `${CLAUDE_PLUGIN_ROOT}/workflows/dev-workflow.md` via the Read tool before any other action. The `@`-reference above may not be inlined by every harness; the explicit Read guarantees the workflow body is in context.

Then execute every `<step>` block in the file in order. Do NOT skip `context_init`. Do NOT dispatch any `Task(subagent_type="devt:*", ...)` without the workflow's `<scope_trust>`, `<scope_hint>`, and `<memory_signal>` blocks injected into the prompt — raw dispatches bypass the Graphify-first protocol and produce grep-quality output.

Execute the full development workflow from the referenced file end-to-end. The task description is provided as the command argument.

If the argument contains `--autonomous`, enable autonomous mode:
- Skip all phase transition confirmations (AskUserQuestion prompts)
- Auto-proceed when quality gates pass
- Still pause for: review score < 50, critical errors, max iteration limits, architectural decisions
- Display status reports at each phase for visibility

Additional autonomous mode flags:
- `--to <phase>` — Run phases up to and including the named phase, then stop (e.g., `--to test` stops after testing)
- `--only <phase>` — Run only the named phase in isolation (e.g., `--only review` runs only review)
- `--chain` — After completing, auto-invoke the next logical workflow step (enables discuss->plan->implement chaining via autonomous_chain in state)

Valid phases: context_init, scan, plan, implement, test, review, verify, docs, retro, complete
</process>
