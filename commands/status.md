---
name: status
description: Show workflow status by default. --report=session|weekly, --stats=tokens|mcp|hooks, and --health route to specialized telemetry/diagnostic workflows.
argument-hint: "[--report=session|weekly] [--stats=tokens|mcp|hooks] [--health [--repair]]"
---

<tool_restrictions>
This workflow uses: Bash, Read, Glob
</tool_restrictions>

<objective>
Show current workflow progress by default. Parameter modes:
- `--report=session` — end-of-session summary (commits, files, decisions, outcomes)
- `--report=weekly` — weekly development activity from git history
- `--stats=tokens` — token usage telemetry (cache hit rate, per-session breakdown)
- `--stats=mcp` — per-MCP-tool stats (error rate, p50/p95/p99 durations)
- `--stats=hooks` — per-hook fire count + brittleness + migration ROI estimate
- `--health [--repair]` — diagnose plugin health (config, state, rules, hooks)
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/status.md
@${CLAUDE_PLUGIN_ROOT}/workflows/session-report.md
@${CLAUDE_PLUGIN_ROOT}/workflows/weekly-report.md
@${CLAUDE_PLUGIN_ROOT}/workflows/tokens.md
@${CLAUDE_PLUGIN_ROOT}/workflows/mcp-stats.md
@${CLAUDE_PLUGIN_ROOT}/workflows/health.md
</execution_context>

<process>
**Mandatory first action**: Parse $ARGUMENTS for the routing flag, then Read the resolved workflow file from the table below (default: `${CLAUDE_PLUGIN_ROOT}/workflows/status.md`) via the Read tool. The `@`-references above may not be inlined by every harness; the explicit Read guarantees the workflow body is in context.

**Step 1 — Parse $ARGUMENTS for routing flags.** Detect ONE primary routing flag (mutually exclusive across the three families). Strip the matched flag from $ARGUMENTS before passing remaining options to the workflow.

Routing table (apply first match):

| Detected in $ARGUMENTS | Action |
|---|---|
| `--report=session` | Read `${CLAUDE_PLUGIN_ROOT}/workflows/session-report.md` and execute |
| `--report=weekly` | Read `${CLAUDE_PLUGIN_ROOT}/workflows/weekly-report.md` and execute |
| `--stats=tokens` | Read `${CLAUDE_PLUGIN_ROOT}/workflows/tokens.md` and execute |
| `--stats=mcp` | Read `${CLAUDE_PLUGIN_ROOT}/workflows/mcp-stats.md` and execute |
| `--stats=hooks` | Run `node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" hook-cost-estimate ${REST}` where `${REST}` is remaining $ARGUMENTS (typically `--window=7d`) and display the JSON output |
| `--health` | Read `${CLAUDE_PLUGIN_ROOT}/workflows/health.md` and execute (pass `--repair` through if present) |
| (no flag — default) | Read `${CLAUDE_PLUGIN_ROOT}/workflows/status.md` and execute |

Invalid `--report=<name>` or `--stats=<name>` values: STOP with error listing valid values.

**Step 2 — Read the resolved workflow file via the Read tool.** (Skip for `--stats=hooks` which is a direct CLI invocation.)

**Step 3 — Execute every `<step>` block in the loaded file in order.** Do NOT skip `context_init`. Do NOT dispatch any `Task(subagent_type="devt:*", ...)` without the workflow's `<scope_trust>`, `<scope_hint>`, and `<memory_signal>` blocks injected into the prompt.

## Default status output

When no flag is set, the workflow surfaces:
- Current phase + step completion
- Pre-Flight Brief state (FRESH | STALE | MISSING with generated_at timestamp) when `.devt/state/preflight-brief.md` exists
- Pending blockers and suggested next action

STALE Brief means a prior File Pre-Flight detected scope expansion; re-run `/devt:workflow --mode=preflight "<refined task>"` (Phase 2 form) or `/devt:preflight "<refined task>"` (direct form) to refresh.
</process>
