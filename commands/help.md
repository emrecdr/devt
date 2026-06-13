---
name: help
description: Show devt commands organized by tier — basics first, advanced parameter forms on demand
argument-hint: "[--all]"
---

<objective>
Display devt commands in tiered groups. Default view shows only the 15 family-head commands. `--all` flag surfaces the full inventory including the parameter surface and the 4 specialized direct-callable tools.
</objective>

<process>
Parse `$ARGUMENTS` for `--all` flag. If present, print the FULL guide (Tier 1+2+3 + Parameter Surface + Specialized Tools). If absent, print only Tier 1+2+3 sections. Do NOT modify, summarize, or abbreviate the output below.

If `--all` is NOT in arguments, print:

```
# devt — Command Reference (15 visible · 4 specialized)

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

## Tier 3 — Knowledge & Admin

/devt:memory <subcommand>       Permanent ADR/Concept/Flow/REJ layer (init, query, promote, …)
/devt:note "idea"               Quick idea capture without derailing current work
/devt:setup --<op>              Admin: --init | --update | --uninstall | --health

## Family-Head Parameter Surface

  /devt:workflow "<task>" [--mode=specify|plan|research|implement|clarify|fast|docs]
                          [--pause|--cancel|--retro]
                          [--autonomous] [--to <phase>] [--only <phase>] [--chain]
                          [--tdd] [--dry-run]

  /devt:review            [--focus=code|arch|quality|security] [--quick]

  /devt:debug "<bug>"     [--mode=forensics]

  /devt:status            [--report=session|weekly]
                          [--stats=tokens|mcp|hooks]
                          [--health [--repair]]

  /devt:note "<idea>"     [--defer] [--tags=a,b,c]

  /devt:setup             --init | --update | --uninstall | --health

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

  First-time project setup:
    /devt:setup --init

  Diagnose plugin problems:
    /devt:setup --health

  See token telemetry:
    /devt:status --stats=tokens

For the 4 specialized direct-callable tools, run /devt:help --all
```

Else (`--all` IS in arguments), print the SAME Tier 1+2+3 + Parameter Surface sections AS ABOVE, followed by:

```

## Specialized Direct-Callable Tools (4 — hidden from /-autocomplete, typed-callable)

These 4 commands have narrow use cases that don't fold cleanly into a
family-head parameter form. They're hidden from `/`-autocomplete (use
`user-invocable: false`) but invocable by typing the full name.

/devt:preflight "<task>"        Generate a Topic Pre-Flight Brief on demand. Auto-fired
                                by every dev workflow at context_init; standalone for
                                ad-hoc Brief generation.

/devt:autoskill                 Analyze the session for skill/agent improvement patterns.
                                Proposes additions to .devt/state/autoskill-proposals.md;
                                curator decides what merges into skill-index.yaml.

/devt:thread "<name>"           Persistent context threads for multi-session work.
                                Subcommands: create, list, resume, update. Each thread
                                carries its own scratch + decision log across sessions.

/devt:council "<decision>"      Pressure-test a high-stakes engineering decision through
                                5 advisors (Contrarian / First Principles / Generalizer /
                                Newcomer / Pragmatist) with adversarial peer review and
                                chairman synthesis. Add --mixed-models for opus/sonnet/
                                haiku diversity at extra cost. Transcript saves to
                                .devt/state/council-*.md.

## What Happened to /devt:init, /devt:health, /devt:retro, etc?

Phase 3 of the v0.93 UX simplification deleted 18 direct-form commands and
folded their functionality under family-head + parameter forms:

  /devt:init             → /devt:setup --init
  /devt:update           → /devt:setup --update
  /devt:uninstall        → /devt:setup --uninstall
  /devt:health           → /devt:setup --health
  /devt:arch-health      → /devt:review --focus=arch
  /devt:quality          → /devt:review --focus=quality
  /devt:forensics        → /devt:debug --mode=forensics
  /devt:clarify          → /devt:workflow --mode=clarify
  /devt:fast             → /devt:workflow --mode=fast
  /devt:docs             → /devt:workflow --mode=docs
  /devt:retro            → /devt:workflow --retro
  /devt:pause            → /devt:workflow --pause
  /devt:cancel-workflow  → /devt:workflow --cancel
  /devt:defer            → /devt:note --defer
  /devt:session-report   → /devt:status --report=session
  /devt:weekly-report    → /devt:status --report=weekly
  /devt:tokens           → /devt:status --stats=tokens
  /devt:mcp-stats        → /devt:status --stats=mcp

Casual user surface: 15 family-head commands instead of 36 equal-tier commands.
```

End printed output. Do not add commentary or summarization after the code block.
</process>
