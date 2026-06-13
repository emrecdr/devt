---
name: help
description: Show devt commands organized by tier — basics first, advanced parameter forms on demand
argument-hint: "[--all]"
---

<objective>
Display devt commands in tiered groups. Default view shows only the 15 family-head commands — the rest are typed-callable but hidden from the `/`-autocomplete and accessible via parameter modes on the family heads. `--all` flag surfaces the full inventory plus the parameter-form cross-reference.
</objective>

<process>
Parse `$ARGUMENTS` for `--all` flag. If present, print the FULL guide (Tier 1+2+3 + Advanced inventory + parameter cross-reference). If absent, print only Tier 1+2+3 sections. Do NOT modify, summarize, or abbreviate the output below.

If `--all` is NOT in arguments, print:

```
# devt — Command Reference (15 visible · 22 advanced)

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

Many family heads accept parameter modes to access advanced functionality
without leaving the casual surface. Show the parameter form with --all.

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

For the full 22-command advanced inventory and direct-form aliases,
run /devt:help --all
```

Else (`--all` IS in arguments), print the SAME Tier 1+2+3 + Parameter Surface sections AS ABOVE, followed by:

```

## Advanced Direct-Form Commands (22 — typed-callable, hidden from /-autocomplete)

These commands are installed and work when typed directly. They're hidden
from the `/`-autocomplete menu and have parameter-form aliases on the
family heads above. Typing the direct form still works for muscle memory
or legacy scripts.

### Workflow Modes (folded under /devt:workflow --mode=)

/devt:clarify          === /devt:workflow --mode=clarify
/devt:fast "task"      === /devt:workflow --mode=fast
/devt:docs             === /devt:workflow --mode=docs
/devt:retro            === /devt:workflow --retro

### Workflow Lifecycle (folded under /devt:workflow --)

/devt:pause            === /devt:workflow --pause
/devt:cancel-workflow  === /devt:workflow --cancel
/devt:defer "todo"     === /devt:note --defer "todo"

### Admin & Setup (folded under /devt:setup --)

/devt:init             === /devt:setup --init
/devt:update           === /devt:setup --update
/devt:uninstall        === /devt:setup --uninstall
/devt:health [--repair] === /devt:setup --health [--repair]

### Architecture & Quality (folded under /devt:review --focus=)

/devt:arch-health      === /devt:review --focus=arch
/devt:quality          === /devt:review --focus=quality

### Telemetry & Reports (folded under /devt:status --report= or --stats=)

/devt:session-report   === /devt:status --report=session
/devt:weekly-report    === /devt:status --report=weekly
/devt:tokens           === /devt:status --stats=tokens
/devt:mcp-stats        === /devt:status --stats=mcp

### Diagnostics (folded under /devt:debug --mode=)

/devt:forensics        === /devt:debug --mode=forensics

### Specialized Tools (no fold — direct-call only)

/devt:preflight "task"          Generate a Topic Pre-Flight Brief on demand
/devt:autoskill                 Detect session correction patterns, propose skill upgrades
/devt:thread "name"             Persistent context threads for cross-session investigations
/devt:council "decision"        Pressure-test high-stakes decisions through 5 advisors

The four specialized tools are kept direct-callable because their use
cases are narrow enough that a parameter form would obscure them; they
are intentionally surfaced only to advanced users who already know they
exist.
```

End printed output. Do not add commentary or summarization after the code block.
</process>
