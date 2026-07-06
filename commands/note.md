---
name: note
description: Zero-friction idea capture — quickly save a thought without derailing current work. --defer routes to .devt/state/deferred.md for persistent TODOs that survive across workflows.
argument-hint: "<idea text> [--defer] [--tags=a,b,c]"
---

<tool_restrictions>
This workflow uses: Read, Write, Bash
</tool_restrictions>

<objective>
Capture an idea instantly without disrupting the current workflow. Notes can be listed or promoted to tasks later. `--defer` writes to `.devt/state/deferred.md` instead — the deferred queue persists across workflow resets (reset-exempt) for ideas that should outlive the current work session.
</objective>

<process>
**Mandatory first action**: Parse $ARGUMENTS for the --defer flag, then Read the resolved workflow file from the table below (default: `${CLAUDE_PLUGIN_ROOT}/workflows/note.md`) via the Read tool. The workflow body is NOT preloaded — the explicit Read is the only load path.

**Step 1 — Parse $ARGUMENTS for --defer flag.** Strip the flag from $ARGUMENTS before passing the remaining text to the workflow.

Routing table:

| Detected in $ARGUMENTS | Workflow file to Read |
|---|---|
| `--defer` | `${CLAUDE_PLUGIN_ROOT}/workflows/defer.md` |
| (no flag — default) | `${CLAUDE_PLUGIN_ROOT}/workflows/note.md` |

**Step 2 — Read the resolved workflow file via the Read tool.**

**Step 3 — Execute every `<step>` block in the loaded file in order.** The note text (with routing flag stripped) is the workflow argument.

## Subcommands (default mode only)

When no `--defer` flag is present, these subcommands operate on the ephemeral notes layer:

- `/devt:note <text>` — append a note
- `/devt:note list` — list current notes
- `/devt:note promote <N>` — promote note N to a task

## Memory integration

This command does not auto-fire a Pre-Flight Brief (it's a meta workflow, not a dev workflow). However, if `.devt/state/preflight-brief.md` exists from a prior workflow, downstream consumers (e.g., the `/devt:workflow --mode=forensics` post-mortem path) may surface it as context.

For ADR/Concept/Flow lookups, use `node bin/devt-tools.cjs memory query <terms>` or the MCP `query_fts` tool. For REJ tombstone awareness, `node bin/devt-tools.cjs memory rejected-keywords` enumerates active suppressions. See `docs/MEMORY.md`.
</process>
