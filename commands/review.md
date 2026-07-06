---
name: review
description: Standalone code review — READ-ONLY analysis. --focus routes to specialized reviews (architecture, quality gates, security emphasis).
argument-hint: "[--focus=code|arch|quality|security] [--quick] [--lite|--full]"
---

<tool_restrictions>
This workflow uses: Bash, Read, Glob, Grep, Agent
</tool_restrictions>

<objective>
Perform a standalone code review of the current changes or specified files. Read-only — no edits or writes. `--focus` switches the lens: code (default), arch (architectural-health scan), quality (lint/typecheck/tests gate), security (review with security emphasis).
</objective>

<process>
**Mandatory first action**: Parse $ARGUMENTS for the --focus flag, then Read the resolved workflow file from the table below (default: `${CLAUDE_PLUGIN_ROOT}/workflows/code-review.md`) via the Read tool. The workflow body is NOT preloaded — the explicit Read is the only load path.

**Step 1 — Parse $ARGUMENTS for --focus flag.** Strip the matched flag from $ARGUMENTS before passing the remaining scope/options to the workflow.

Routing table (apply first match):

| Detected in $ARGUMENTS | Workflow file to Read |
|---|---|
| `--focus=arch` | `${CLAUDE_PLUGIN_ROOT}/workflows/arch-health-scan.md` |
| `--focus=quality` | `${CLAUDE_PLUGIN_ROOT}/workflows/quality-gates.md` |
| `--focus=security` | `${CLAUDE_PLUGIN_ROOT}/workflows/code-review.md` (inject `<focus>security</focus>` into context_init) |
| `--focus=code` (or absent) | `${CLAUDE_PLUGIN_ROOT}/workflows/code-review.md` (default) |

If an unrecognized `--focus=<name>` value appears, STOP with error: `"Invalid --focus value '<name>'. Valid: code, arch, quality, security."`

`--quick` is an orthogonal flag — when present, also inject `<mode>quick</mode>` so the reviewer skips deep community-filter analysis.

`--lite` / `--full` are orthogonal flags that scale review ceremony to change size. `--lite` (when the operator has judged the change small) injects `<mode>lite</mode>` — context_init runs the graphify **headline** (single blast_radius: effect_size / god_node / modules) plus the deterministic god-node check, but skips the heavyweight multi-tier drill-down. `--full` injects `<mode>full</mode>`, forcing the complete drill-down regardless. Neither is auto-selected — the workflow's `review-weight` advisory (below) announces a light-vs-heavy *recommendation* on every review, but only the operator's flag changes behavior.

**Step 2 — Read the resolved workflow file via the Read tool.**

**Step 3 — Execute every `<step>` block in the loaded file in order.** Do NOT skip `context_init` — it generates the Graphify impact plan and writes `.devt/state/graphify-impact-plan.json` + `graph-impact.md`. Do NOT dispatch any `Task(subagent_type="devt:*", ...)` without the workflow's `<scope_trust>`, `<scope_hint>`, and `<memory_signal>` blocks injected into the prompt.

Reports findings with severity, location, and recommendations.
</process>
