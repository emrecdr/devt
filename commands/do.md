---
name: do
description: Route freeform text to the right devt command — describe what you want and it picks the command
argument-hint: "<what you want to do>"
---

<objective>
Analyze freeform natural language and dispatch to the most appropriate devt command.
Acts as a smart dispatcher — never does work itself.
</objective>

<process>
**Mandatory first action**: read `${CLAUDE_PLUGIN_ROOT}/workflows/do.md` via the Read tool before any other action. The workflow body is NOT preloaded — the explicit Read is the only load path.

Then execute every `<step>` block in the file in order. Do NOT skip `context_init`. Do NOT dispatch any `Task(subagent_type="devt:*", ...)` without the workflow's `<scope_trust>`, `<scope_hint>`, and `<memory_signal>` blocks injected into the prompt — raw dispatches bypass the Graphify-first protocol and produce grep-quality output.

Execute the do workflow from the referenced file. The workflow is a pure dispatcher — read the routing table, pick the matching command, invoke it via the Skill tool. devt slash commands are addressable as skills with the `devt:` prefix (e.g., `/devt:debug` ↔ `Skill tool: name=devt:debug`).

**Hard contract — the only valid final action is the Skill tool call.**

"Doing the work" — all forbidden in this turn — includes:
- Answering the user's underlying question in prose, even partially
- Running diagnostics, reading code, grepping the repo, calling Bash
- Asking clarifying questions about the task itself (the routed command will ask)
- Validating whether the task is real, scoped correctly, or worth doing

If you find yourself drafting more than the routing decision line + the Skill tool call, you have broken the contract — back out and dispatch.
</process>

## Memory integration

This command does not auto-fire `/devt:preflight` (it's a meta workflow, not a dev workflow). However:
- If `.devt/state/preflight-brief.md` exists from a prior workflow, this command may surface it as context (e.g., `/devt:debug --mode=forensics` reads it when investigating failures; `/devt:thread` references it for cross-session work).
- For ADR/Concept/Flow lookups, use `node bin/devt-tools.cjs memory query <terms>` or the MCP `query_fts` tool.
- For REJ tombstone awareness, `node bin/devt-tools.cjs memory rejected-keywords` enumerates active suppressions.

See `docs/MEMORY.md` for the full surface.
