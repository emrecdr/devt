---
name: debug
description: Systematic debugging with 4-phase investigation — root cause first, then fix. --mode=forensics switches to post-mortem analysis of failed/stuck workflows.
argument-hint: "<bug description> [--mode=forensics]"
---

<tool_restrictions>
This workflow uses: Read, Write, Edit, Bash, Glob, Grep, Agent
</tool_restrictions>

<objective>
Debug a specific issue using systematic 4-phase investigation. Dispatches a debugger agent in isolated context. `--mode=forensics` routes to post-mortem analysis of a stuck or failed workflow instead — useful when `/devt:next` hits a wall and the cause needs to be reconstructed from `.devt/state/` + git history.
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/debug.md
@${CLAUDE_PLUGIN_ROOT}/workflows/forensics.md
</execution_context>

<process>
**Mandatory first action**: Parse $ARGUMENTS for the --mode flag, then Read the resolved workflow file from the table below (default: `${CLAUDE_PLUGIN_ROOT}/workflows/debug.md`) via the Read tool. The `@`-references above may not be inlined by every harness; the explicit Read guarantees the workflow body is in context.

**Step 1 — Parse $ARGUMENTS for --mode flag.** Strip the matched flag from $ARGUMENTS before passing the remaining text to the workflow.

**Step 1.5 — Elicit bug description if empty.** After flag-stripping, if the remaining text is empty, ask the user in plain prose: *"Describe the bug or error you're seeing — include the symptom, where it happens, and what you expected."* Wait for the response and use it as the bug description.

Routing table:

| Detected in $ARGUMENTS | Workflow file to Read |
|---|---|
| `--mode=forensics` | `${CLAUDE_PLUGIN_ROOT}/workflows/forensics.md` |
| (no flag — default) | `${CLAUDE_PLUGIN_ROOT}/workflows/debug.md` |

If an unrecognized `--mode=<name>` value appears, STOP with error: `"Invalid --mode value '<name>'. Valid: forensics."`

**Step 2 — Read the resolved workflow file via the Read tool.**

**Step 3 — Execute every `<step>` block in the loaded file in order.** Do NOT skip `context_init`. Do NOT dispatch any `Task(subagent_type="devt:*", ...)` without the workflow's `<scope_trust>`, `<scope_hint>`, and `<memory_signal>` blocks injected into the prompt — raw dispatches bypass the Graphify-first protocol and produce grep-quality output.

The bug description (with routing flag stripped) is the workflow argument.
</process>
