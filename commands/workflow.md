---
name: workflow
description: Build, fix, or improve anything — auto-detects complexity. Accepts --mode for phase routing, lifecycle flags (--pause|--cancel|--retro), and pipeline control flags.
argument-hint: "<task> [--mode=specify|plan|research|implement|clarify|fast|docs] [--pause|--cancel|--retro] [--autonomous] [--to <phase>] [--only <phase>] [--chain] [--tdd] [--dry-run]"
---

<tool_restrictions>
This workflow uses: Bash, Read, Write, Edit, Agent, Glob, Grep, AskUserQuestion
</tool_restrictions>

<objective>
Execute the development workflow for a given task. The primary family head of devt — auto-detects complexity tier (TRIVIAL/SIMPLE/STANDARD/COMPLEX) and runs the full pipeline by default. `--mode` switches to a single-phase workflow (specify, plan, research, implement, clarify, fast, docs). Lifecycle flags (--pause, --cancel, --retro) operate on the active workflow state.
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/dev-workflow.md
@${CLAUDE_PLUGIN_ROOT}/workflows/specify.md
@${CLAUDE_PLUGIN_ROOT}/workflows/create-plan.md
@${CLAUDE_PLUGIN_ROOT}/workflows/research-task.md
@${CLAUDE_PLUGIN_ROOT}/workflows/quick-implement.md
@${CLAUDE_PLUGIN_ROOT}/workflows/clarify-task.md
@${CLAUDE_PLUGIN_ROOT}/workflows/fast.md
@${CLAUDE_PLUGIN_ROOT}/workflows/docs-extraction.md
@${CLAUDE_PLUGIN_ROOT}/workflows/pause-work.md
@${CLAUDE_PLUGIN_ROOT}/workflows/lesson-extraction.md
</execution_context>

<process>
**Mandatory first action**: Parse $ARGUMENTS for the routing flag, then Read the resolved workflow file from the table below (default: `${CLAUDE_PLUGIN_ROOT}/workflows/dev-workflow.md`) via the Read tool. The `@`-references above may not be inlined by every harness; the explicit Read guarantees the workflow body is in context.

**Step 1 — Parse $ARGUMENTS for routing flags.** Detect ONE primary flag (mutually exclusive). Strip the matched flag from $ARGUMENTS before passing the remaining text to the workflow as the task description.

Routing table (apply first match):

| Detected in $ARGUMENTS | Workflow file to Read |
|---|---|
| `--mode=specify` | `${CLAUDE_PLUGIN_ROOT}/workflows/specify.md` |
| `--mode=plan` | `${CLAUDE_PLUGIN_ROOT}/workflows/create-plan.md` |
| `--mode=research` | `${CLAUDE_PLUGIN_ROOT}/workflows/research-task.md` |
| `--mode=implement` | `${CLAUDE_PLUGIN_ROOT}/workflows/quick-implement.md` |
| `--mode=clarify` | `${CLAUDE_PLUGIN_ROOT}/workflows/clarify-task.md` |
| `--mode=fast` | `${CLAUDE_PLUGIN_ROOT}/workflows/fast.md` |
| `--mode=docs` | `${CLAUDE_PLUGIN_ROOT}/workflows/docs-extraction.md` |
| `--pause` | `${CLAUDE_PLUGIN_ROOT}/workflows/pause-work.md` |
| `--cancel` | (no workflow body — run `node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state reset` and STOP) |
| `--retro` | `${CLAUDE_PLUGIN_ROOT}/workflows/lesson-extraction.md` |
| (no routing flag present) | `${CLAUDE_PLUGIN_ROOT}/workflows/dev-workflow.md` (default — full dev pipeline) |

If an unrecognized `--mode=<name>` value appears, STOP with error: `"Invalid --mode value '<name>'. Valid: specify, plan, research, implement, clarify, fast, docs."`

If `--cancel` is matched, run the state reset command and STOP — do NOT load a workflow body.

**Step 2 — Read the resolved workflow file via the Read tool.** The `@`-references above may not be inlined by every harness; the explicit Read guarantees the workflow body is in context.

**Step 3 — Execute every `<step>` block in the loaded file in order.** Do NOT skip `context_init`. Do NOT dispatch any `Task(subagent_type="devt:*", ...)` without the workflow's `<scope_trust>`, `<scope_hint>`, and `<memory_signal>` blocks injected into the prompt — raw dispatches bypass the Graphify-first protocol and produce grep-quality output.

The task description (with routing flag stripped) is the workflow argument.

## Default Pipeline (workflows/dev-workflow.md) Flag Suite

When no `--mode` or lifecycle flag is set, the full dev pipeline accepts these additional flags:

- `--autonomous` — Skip phase transition confirmations; auto-proceed when quality gates pass. Still pauses for: review score < 50, critical errors, max iteration limits, architectural decisions.
- `--to <phase>` — Run phases up to and including the named phase, then stop (e.g., `--to test` stops after testing).
- `--only <phase>` — Run only the named phase in isolation (e.g., `--only review` runs only review).
- `--chain` — After completing, auto-invoke the next logical workflow step (enables chaining via autonomous_chain in state).
- `--tdd` — Test-driven development mode: tests written BEFORE implementation. Auto-injects `tdd-patterns` skill.
- `--dry-run` — Preview the pipeline without executing any agents.

Valid `--to`/`--only` phases: context_init, scan, regression_baseline, plan, implement, test, review, verify, docs, retro, complete.

These flags pass through to `workflows/dev-workflow.md`, which handles detection, validation, and stripping per its own contract.
</process>
