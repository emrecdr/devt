---
name: workflow
description: Build, fix, or improve anything — auto-detects complexity and runs the right pipeline
argument-hint: "<task description> [--autonomous]"
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
Execute the full development workflow from the referenced file end-to-end. The task description is provided as the command argument.

If the argument contains `--autonomous`, enable autonomous mode:
- Skip all phase transition confirmations (AskUserQuestion prompts)
- Auto-proceed when quality gates pass
- Still pause for: review score < 50, critical errors, max iteration limits, architectural decisions
- Display status reports at each phase for visibility
</process>
