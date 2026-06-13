---
name: preflight
description: Generate a Topic Pre-Flight Brief for a task — surfaces governing ADR/CON/FLOW, REJ tombstones, lessons, and (with Graphify) blast radius. Auto-fired by dev workflows.
argument-hint: "<task description>   e.g. /devt:preflight 'Add MFA to AuthService'"
user-invocable: false
---

<tool_restrictions>
This workflow uses: Bash, Read
</tool_restrictions>

<objective>
Produce `.devt/state/preflight-brief.md` — a single document that lists every governing
ADR/Concept/Flow, all relevant REJ tombstones, related operational lessons, and
(when Graphify is enabled) blast-radius analysis for the user's task. The Brief is
the canonical context input for every dev-workflow agent.
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/preflight.md
</execution_context>

<process>
**Mandatory first action**: read `${CLAUDE_PLUGIN_ROOT}/workflows/preflight.md` via the Read tool before any other action. The `@`-reference above may not be inlined by every harness; the explicit Read guarantees the workflow body is in context.

Then execute every `<step>` block in the file in order. Do NOT skip `context_init`. Do NOT dispatch any `Task(subagent_type="devt:*", ...)` without the workflow's `<scope_trust>`, `<scope_hint>`, and `<memory_signal>` blocks injected into the prompt — raw dispatches bypass the Graphify-first protocol and produce grep-quality output.


## When invoked

`/devt:preflight "<task description>"` — runs the full Brief generation against the
user's task and writes the result to `.devt/state/preflight-brief.md`. Returns a
JSON summary (counts per lane, blast radius, status) on stdout.

If the user passes no task description, prompt for one. Do not invent a task.

## Execution

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" preflight generate "<task>"
```

The CLI returns JSON. Render it to the user as:

> Pre-Flight Brief generated → `.devt/state/preflight-brief.md`
>
> Topic: domains=[…], symbols=[…], keywords=[…]
> Governing docs: N (lanes A:n, B:n, C:n, D:n)
> REJ tombstones matched: N
> Operational lessons: N
> Effect size: small | medium | large | unknown (Graphify status)
>
> Read the brief: `cat .devt/state/preflight-brief.md`

After rendering, instruct the user that the Brief is now the source of truth for
this workflow — re-run `/devt:preflight "<refined task>"` only if scope changes
materially (the File Pre-Flight tier in agents handles minor scope drift via
`preflight mark-stale`).

## Subcommands

| Subcommand | Description |
|---|---|
| `generate <task>` (default) | Run lanes A-F + blast radius; write the Brief |
| `topic <task>` | Just extract domains/symbols/keywords (debug) |
| `status` | Read current Brief metadata (FRESH/STALE/MISSING) |
| `mark-stale [reason]` | Mark current Brief STALE — used by File Pre-Flight when scope expanded |

If the first argument starts with `topic`, `status`, or `mark-stale`, route to that
subcommand. Otherwise treat the entire argument as the task description for `generate`.

## Boundaries

- This command is **read-only** on `.devt/memory/index.db` (FTS5 queries, symbol/path lookups).
- It is **write** on `.devt/state/preflight-brief.md` only — no other file is mutated.
- Graphify (when enabled) is invoked via subprocess; failures degrade silently and the
  Brief notes `_Graphify disabled or unavailable_` instead of blocking.
- The Brief is **per-workflow scope** — `/devt:cancel-workflow` and `state reset`
  delete it. Re-running `/devt:preflight` overwrites in place.
- For ephemeral DECs, use `/devt:clarify`. For permanent ADR/Concept/Flow promotion,
  use `/devt:memory promote`. This command does NOT write to `.devt/memory/`.

</process>
