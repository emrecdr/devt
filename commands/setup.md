---
name: setup
description: Admin operations family head — initialize, update, uninstall, or diagnose the devt plugin. Routes to the matching admin workflow based on the chosen flag.
argument-hint: "--init | --update | --uninstall | --health [--repair]"
---

<tool_restrictions>
This workflow uses: Bash, Read, Write, AskUserQuestion
</tool_restrictions>

<objective>
Admin family head — consolidates the four plugin lifecycle operations under one entry. Each operation has its own workflow body; this command parses the requested flag and routes accordingly.
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/project-init.md
@${CLAUDE_PLUGIN_ROOT}/workflows/update.md
@${CLAUDE_PLUGIN_ROOT}/workflows/uninstall.md
@${CLAUDE_PLUGIN_ROOT}/workflows/health.md
</execution_context>

<process>
**Mandatory first action**: Parse $ARGUMENTS for the operation flag, then Read the resolved workflow file from the table below via the Read tool. The `@`-references above may not be inlined by every harness; the explicit Read guarantees the workflow body is in context.

**Step 1 — Parse $ARGUMENTS for the operation flag.** Detect ONE of `--init`, `--update`, `--uninstall`, `--health`. Strip the matched flag from $ARGUMENTS before passing remaining options to the workflow.

Routing table:

| Detected in $ARGUMENTS | Workflow file to Read |
|---|---|
| `--init` | `${CLAUDE_PLUGIN_ROOT}/workflows/project-init.md` |
| `--update` | `${CLAUDE_PLUGIN_ROOT}/workflows/update.md` (passes `--force` through if present) |
| `--uninstall` | `${CLAUDE_PLUGIN_ROOT}/workflows/uninstall.md` |
| `--health` | `${CLAUDE_PLUGIN_ROOT}/workflows/health.md` (passes `--repair` through if present) |
| (no flag) | **Interactive picker** — see Step 1.5 |

If multiple flags are present, STOP with error: `"setup accepts only ONE operation at a time."`

**Step 1.5 — Interactive picker (no-flag case).** When the user typed `/devt:setup` with no operation flag, present an `AskUserQuestion` to pick the operation. This avoids the "STOP with usage hint" dead-end and matches CC's interactive-picker pattern. Use this exact question:

```yaml
question: "Which devt admin operation do you want to run?"
header: "Setup op"
multiSelect: false
options:
  - label: "Initialize project (--init)"
    description: "First-time setup: scaffold .devt/rules/ from a template + write .devt/config.json. Required before the first dev workflow runs."
  - label: "Diagnose plugin health (--health)"
    description: "Run 19 diagnostic checks across config, state, rules, hooks, agents, versions. Use when workflows fail unexpectedly."
  - label: "Check for updates (--update)"
    description: "Check GitHub for newer devt plugin versions. Adds --force flag option."
  - label: "Uninstall devt (--uninstall)"
    description: "Remove devt — reinit (keep memory), project reset, full clean, or plugin uninstall. AskUserQuestion-gated on every destructive op."
```

After the user picks, route to the matching workflow file from the routing table above and proceed to Step 2. If the user declines or hits Esc, STOP cleanly.

**Step 2 — Read the resolved workflow file via the Read tool.**

**Step 3 — Execute every `<step>` block in the loaded file in order.** Each admin workflow is a self-contained one-shot operation — no agent dispatches required.

## Operation summary

- `--init` — Interactive project setup wizard. Creates `.devt/rules/` from a stack-matched template, writes `.devt/config.json`, scaffolds memory layer. Required before the first dev workflow runs.
- `--update` — Check GitHub for newer plugin versions. With `--force`, bypasses the 24h check cache.
- `--uninstall` — Remove devt with selectable scope: reinit (keep memory), project reset, full clean, plugin uninstall. AskUserQuestion-gated.
- `--health [--repair]` — Run 19 diagnostic checks across config, state, rules, hooks, agents, versions. `--repair` auto-fixes safe issues.
</process>
