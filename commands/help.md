---
name: help
description: Show all devt commands with use cases — basics to advanced
---

<objective>
Display a comprehensive guide to all devt commands, organized by experience level with practical use cases. Print the content below directly — do not delegate to a workflow.
</objective>

<process>
Print the following guide to the user. Do NOT modify, summarize, or abbreviate it.

```
# devt — Command Reference (29 commands)

## Getting Started

/devt:do "what you want"  Don't know which command? Describe it — devt routes to the right one
/devt:init                Set up devt for your project (creates .devt/rules/, .devt/config.json)
/devt:help                You're here
/devt:status              Where am I? What step is the workflow on?
/devt:health              Is devt working? Check config, hooks, state integrity. Supports --repair

## The Main Commands

### /devt:workflow "task description"
The primary command. Give it a task and it handles everything:
  - Auto-detects complexity (TRIVIAL → SIMPLE → STANDARD → COMPLEX)
  - Dispatches specialized agents: programmer, tester, code-reviewer, etc.
  - Manages retries, repair operators, and escalation

Use cases:
  /devt:workflow "add user authentication with JWT"
  /devt:workflow "fix the N+1 query in the orders endpoint"
  /devt:workflow "refactor payment service to use strategy pattern"
  /devt:workflow "add pagination to GET /api/contacts"

### /devt:implement "task description"
Quick mode — code + test + review, skip docs and retro. Same as workflow with SIMPLE tier.

Use cases:
  /devt:implement "add email validation to signup form"
  /devt:implement "fix the 500 error on empty cart checkout"

### /devt:fast "task description"
Inline execution for trivial tasks — no subagents, no planning.

Use cases:
  /devt:fast "rename USER_TABLE constant to USERS_TABLE"
  /devt:fast "add type hint to process_payment return value"
  /devt:fast "fix typo in error message"

## Before You Build

### /devt:specify
Interactive PRD creation — systematic interview + codebase analysis. Produces structured spec with decisions, API design, test scenarios, and task breakdown.

Use when: You have a feature idea that needs scoping before implementation.
  /devt:specify → (answers questions) → spec.md → /devt:workflow

### /devt:plan "task description"
Create a detailed implementation plan — identifies files, breaks into steps, validates approach.

Use when: Task is complex and you want to review the plan before coding.
  /devt:plan "migrate from SQLAlchemy to SQLModel" → review plan → /devt:workflow

### /devt:research "topic"
Investigate codebase patterns, identify pitfalls, recommend strategy.

Use when: Entering unfamiliar code or choosing between approaches.
  /devt:research "how does the event system work"
  /devt:research "options for adding real-time notifications"

### /devt:clarify
Discuss implementation choices, capture decisions. Identifies gray areas before coding.

Use when: Multiple valid approaches exist and you want to decide upfront.
  /devt:clarify → "should we use WebSocket or SSE for live updates?"

## During Work

### /devt:next
Auto-detect where you left off and continue. Reads workflow state and acts.

Use when: Resuming after a break, or unsure what step comes next.

### /devt:pause
Pause workflow and create structured handoff. Captures progress, decisions, context.

Use when: Stopping mid-workflow (end of day, switching tasks).
  /devt:pause → close session → new session → /devt:next (resumes)

### /devt:status
Show current workflow step, what completed, what's next, any blockers.

### /devt:cancel-workflow
Abort the active workflow and reset state. Use when stuck or starting over.

### /devt:note "idea"
Quick idea capture without derailing current work. Promote to task later.

Use when: Mid-workflow insight you don't want to forget.
  /devt:note "we should add rate limiting to this endpoint"
  /devt:note "the auth middleware needs refactoring"

## After You Build

### /devt:review
Standalone code review — READ-ONLY analysis with findings and severity ratings.

Use when: Want a second opinion before committing.

### /devt:ship
Create a PR with auto-generated description from workflow artifacts. If .devt/rules/api-changelog.md exists, generates a changelog entry automatically.

Use when: Workflow complete, ready to merge.
  /devt:ship → PR created with summary, test plan, review verdict

### /devt:retro
Extract lessons from the current session into the learning playbook.

Use when: After completing a task, capture what went well or poorly.

### /devt:session-report
Generate a post-session summary — commits, files changed, decisions, outcomes.

Use when: End of session, handoff to team, or personal review.

## Specialized Tools

### /devt:debug "bug description"
Systematic 4-phase debugging — isolates in fresh context to preserve your session.

Use when: Facing a bug you can't quickly figure out.
  /devt:debug "payments fail silently when Stripe returns 402"
  /devt:debug "tests pass locally but fail in CI"

### /devt:arch-health
Architecture health scan — detect coupling issues, structural drift, violations.

Use when: Before major refactors, or periodic architecture audits.

### /devt:quality
Run quality gates — lint, typecheck, tests as defined in .devt/rules/quality-gates.md.

### /devt:weekly-report
Generate a weekly development activity report from git history.

### /devt:autoskill
Analyze the session for patterns and propose skill/agent improvements. Changes are audited in .devt/autoskill-changelog.md.

### /devt:council "question"
Pressure-test a high-stakes engineering decision through 5 advisors with adversarial peer review (Karpathy LLM Council methodology). Five thinking styles (Contrarian / First Principles / Generalizer / Newcomer / Pragmatist) analyze in parallel, peer-review each other anonymously, then a chairman synthesizes the verdict. Add `--mixed-models` to dispatch advisors across opus/sonnet/haiku for higher reasoning diversity at extra cost. Transcript saved to .devt/state/council-*.md.

Use cases:
  /devt:council "rewrite the state module or strangle it incrementally?"
  /devt:council "REST or events for the new ingestion pipeline?"
  /devt:council --mixed-models "drop SQLite FTS5 for an external index?"

Phrase triggers (no slash command needed): "council this: ...", "pressure-test this", "red team this", "second opinion on this", "devil's advocate".

Skip the council for: factual lookups, syntax fixes, validation-seeking when you've already decided.

### /devt:thread "name"
Persistent context threads for multi-session investigations.

Use when: Research or debugging that spans multiple sessions.
  /devt:thread "payment-migration" → work across sessions → /devt:thread (resume)

## Diagnostics

### /devt:forensics
Post-mortem on failed/stuck workflows — analyzes artifacts, state, git history.

Use when: A workflow failed and you want to understand why.

### /devt:health [--repair]
Diagnose plugin health — 19 checks covering config, state, rules, hooks, agents, versions. --repair auto-fixes safe issues.

### /devt:update
Check for and install devt updates from GitHub.

## Typical Workflows

Don't know which command:
  /devt:do "fix the login bug"  → routes to /devt:debug

Simple bug fix:
  /devt:implement "fix the 404 on GET /users/:id with UUID format"

New feature, well-defined:
  /devt:workflow "add soft delete to contacts module"

New feature, needs scoping:
  /devt:specify → /devt:workflow

Complex task, unfamiliar area:
  /devt:research "how does billing work" → /devt:plan → /devt:workflow

Resuming interrupted work:
  /devt:next

End of session:
  /devt:session-report → /devt:pause
```
</process>
