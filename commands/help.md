---
name: help
description: Show devt commands organized by tier — basics first, advanced on demand
argument-hint: "[--all]"
---

<objective>
Display devt commands in tiered groups. Default view shows only the 14 user-facing commands — the rest are typed-callable but hidden from the `/` autocomplete to reduce noise. `--all` flag surfaces the full inventory including advanced operations.
</objective>

<process>
Parse `$ARGUMENTS` for `--all` flag. If present, print the FULL guide (Tier 1 + Tier 2 + Advanced inventory). If absent, print only Tier 1 + Tier 2 sections. Do NOT modify, summarize, or abbreviate the output below.

If `--all` is NOT in arguments, print:

```
# devt — Command Reference (14 visible · 22 advanced)

## Tier 1 — Daily Commands

/devt:do "what you want"        Describe the task — devt routes to the right command
/devt:workflow "task"           The primary pipeline: scan → implement → test → review → docs
/devt:status                    Where am I? What step? Any blockers?
/devt:next                      Auto-detect next step and run it
/devt:ship                      Create the PR — auto-generates description from artifacts
/devt:help                      You're here ( --all surfaces advanced commands )

## Tier 2 — Verbs by Intent

/devt:specify                   Interactive PRD interview → spec.md
/devt:plan "task"               Detailed implementation plan before coding
/devt:research "topic"          Investigate patterns, identify pitfalls, recommend strategy
/devt:implement "task"          Quick mode — code + test + review, skip docs/retro
/devt:debug "bug"               Systematic 4-phase debug in isolated context
/devt:review                    Standalone read-only code review

## Tier 3 — Knowledge

/devt:memory <subcommand>       Permanent ADR/Concept/Flow/REJ layer (init, query, promote, …)
/devt:note "idea"               Quick idea capture without derailing current work

## Typical Workflows

  Don't know what to call it:
    /devt:do "fix login bug"          → routes to /devt:debug

  Simple bug fix:
    /devt:implement "fix 404 on GET /users/:id with UUID format"

  New feature, well-defined:
    /devt:workflow "add soft delete to contacts module"

  New feature, needs scoping:
    /devt:specify → review → /devt:workflow

  Complex task, unfamiliar code:
    /devt:research "how does billing work" → /devt:plan → /devt:workflow

  Resuming interrupted work:
    /devt:next

For the 22 advanced commands (workflow control, admin, telemetry, specialized tools),
run /devt:help --all
```

Else (`--all` IS in arguments), print the SAME Tier 1+2+3 sections AS ABOVE, followed by:

```

## Advanced Commands (22 — typed-callable, hidden from /-autocomplete)

These commands ARE installed and work when typed directly. They're hidden from
the `/`-autocomplete menu to keep the day-to-day surface clean. Casual users
rarely need them; advanced users can type the full name (e.g., /devt:health).

### Workflow Modes ( specialized phases of the main pipeline )

/devt:clarify                   Discuss gray-area implementation choices before coding
/devt:fast "task"               Inline execution for trivial tasks — no subagents
/devt:docs                      Standalone docs refresh without active workflow
/devt:retro                     Extract lessons from current session into the playbook

### Workflow Lifecycle Control

/devt:pause                     Pause current workflow with structured handoff
/devt:cancel-workflow           Abort active workflow and reset state
/devt:defer "todo"              Capture a deferred TODO to .devt/state/deferred.md

### Admin & Setup

/devt:init                      Interactive project setup wizard
/devt:update                    Check for and install devt updates from GitHub
/devt:uninstall                 Reset or uninstall devt
/devt:health [--repair]         Diagnose plugin health — 19 checks

### Architecture & Quality

/devt:arch-health               Architecture health scan — coupling, drift, violations
/devt:quality                   Run lint + typecheck + tests per .devt/rules/quality-gates.md

### Telemetry & Reports

/devt:session-report            End-of-session summary — commits, files, decisions
/devt:weekly-report             Weekly development activity from git history
/devt:tokens                    Token usage telemetry — cache hit rate, per-session breakdown
/devt:mcp-stats                 Per-MCP-tool stats — error rate, p50/p95/p99 durations

### Diagnostics

/devt:forensics                 Post-mortem on stuck/failed workflows

### Specialized Tools

/devt:preflight "task"          Generate a Topic Pre-Flight Brief on demand
/devt:autoskill                 Detect session correction patterns, propose skill upgrades
/devt:thread "name"             Persistent context threads for cross-session investigations
/devt:council "decision"        Pressure-test high-stakes decisions through 5 advisors

## Roadmap — Phase 2 Parameter Consolidation

Several advanced commands will fold into parameter modes of the Tier-1 family heads:

  /devt:fast → /devt:workflow --tier=trivial
  /devt:clarify → /devt:workflow --mode=clarify
  /devt:docs → /devt:workflow --mode=docs
  /devt:retro → /devt:workflow --retro
  /devt:pause / /devt:cancel-workflow → /devt:workflow --pause / --cancel
  /devt:defer → /devt:note --defer
  /devt:init / /devt:update / /devt:uninstall / /devt:health → /devt:setup --<mode>
  /devt:arch-health / /devt:quality → /devt:review --focus=arch | quality
  /devt:forensics → /devt:debug --mode=forensics
  /devt:session-report / /devt:weekly-report → /devt:status --report=<mode>
  /devt:tokens / /devt:mcp-stats → /devt:status --stats=<mode>

After Phase 2 wires the parameter routing, the family-head form will be the
recommended entry. The direct command names (above) will continue to work
during the transition.
```

End printed output. Do not add commentary or summarization after the code block.
</process>
