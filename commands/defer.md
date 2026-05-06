---
name: defer
description: Capture a deferred TODO to .devt/state/deferred.md — survives across workflows. Use when something should be done later but shouldn't derail current work. Subcommands - list, close, reopen, count, get.
---

<tool_restrictions>
This workflow uses: Read, Write, Bash
</tool_restrictions>

<objective>
Capture a TODO that's been deferred from immediate work. Items live at
`.devt/state/deferred.md` and survive `/devt:cancel-workflow` (reset-exempted),
so a TODO captured in one workflow can be picked up in a later session.
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/defer.md
</execution_context>

<process>
Execute the defer workflow. The argument is the title (or a subcommand).

- `/devt:defer "Add rate limiting"` — capture a new DEF-NNN item
- `/devt:defer list` — show open items (use `--status=closed` for closed, `--tag=X` to filter)
- `/devt:defer close DEF-007` — mark an item as closed
- `/devt:defer reopen DEF-007` — reopen a closed item
- `/devt:defer count` — show {open, closed, total}
- `/devt:defer get DEF-007` — fetch a single item
</process>

## Relationship to other surfaces

- **Different from `.devt/memory/`**: deferred items are transient TODOs, not permanent canonical knowledge. They get done and closed; they're not curator-gated.
- **Different from `// TODO:` code comments**: code comments are colocated with the code they reference; deferred items are project-wide queued work.
- **Different from `/devt:note`**: notes are zero-friction idea capture. Deferred items have explicit lifecycle (open → closed) and surface in `/devt:status` + `/devt:next`.
