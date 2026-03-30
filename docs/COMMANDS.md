# devt Commands Guide

How to use devt -- from your first task to shipping a PR.

---

## Decision Tree

```
What do you need?
  |
  |-- "I'll describe it"                  -->  /devt:do (smart router)
  |-- "Build, fix, or improve something"  -->  /devt:workflow
  |-- "Define a feature first"            -->  /devt:specify
  |-- "Fix a bug"                         -->  /devt:debug
  |-- "Create a PR"                       -->  /devt:ship
  |-- "Not sure / continue from where I left off"  -->  /devt:next
  |-- "Set up a new project"              -->  /devt:init
  |-- "What commands are available?"      -->  /devt:help
```

Six commands for daily work, two for setup/discovery.

---

## Primary Commands

### `/devt:workflow` -- Build anything

The main command. Give it a task, it figures out the rest.

```bash
/devt:workflow "add health check endpoint at GET /health"
/devt:workflow "fix login validation that accepts empty passwords"
/devt:workflow "refactor user service to use repository pattern"
/devt:workflow "update API rate limiting from 100 to 500 req/min"

# Autonomous mode — skip confirmations, auto-proceed if gates pass
/devt:workflow "add health check endpoint" --autonomous
```

**Autonomous mode** (`--autonomous`): Skips phase transition confirmations and auto-proceeds when quality gates pass. Still pauses for: review score below 50, critical errors, max iteration limits, and architectural decisions that need your input.

**What happens internally:**

devt assesses your task and auto-selects a complexity tier:

```
TRIVIAL   (typo, config change)     -->  executes inline, no subagents
  |
SIMPLE    (1-2 files, known pattern) -->  implement --> test --> review
  |
STANDARD  (multiple files)           -->  scan --> implement --> test --> review
  |                                       --> verify --> docs --> retro
COMPLEX   (new patterns, multi-svc)  -->  auto-research --> auto-plan --> scan
                                          --> architect --> implement --> test
                                          --> review --> verify --> docs --> retro
```

You never choose a tier. devt detects it using:
- **Scope**: How many files? (<=3 = TRIVIAL, <=2 = SIMPLE, 10+ = COMPLEX)
- **Risk**: Critical paths, data models, cross-service boundaries?
- **Novelty**: Known pattern or something new?
- **Dependencies**: Cross-cutting concerns (auth, audit, events)?

For STANDARD+ tasks, devt also runs a **risk & simplicity check** -- if a simpler approach exists, it warns you before proceeding.

For COMPLEX tasks, devt **auto-researches** (investigates approaches, patterns, pitfalls) and **auto-plans** (creates ordered task breakdown) before implementation -- you don't need to run separate commands.

**Prior artifacts are used automatically:**

If you ran `/devt:specify` before, the spec feeds into the workflow. Same for any existing `research.md`, `decisions.md`, or `plan.md` in `.devt/state/`. You never need to wire things together manually.

---

### `/devt:specify` -- Define a feature

Use when you have a feature idea but not clear requirements. Produces a structured PRD (Product Requirements Document) through systematic interview.

```bash
/devt:specify "user notification preferences"
/devt:specify "add rate limiting to public API endpoints"
```

**What happens:**

1. Analyzes your codebase for context (existing patterns, modules, conventions)
2. Interviews you systematically -- only non-obvious questions
3. Generates a PRD with: user stories, scope, decisions, API design, test scenarios, task breakdown
4. Saves to `.devt/state/spec.md` (for pipeline) and `docs/specs/` (permanent)
5. Asks what you want to do next:
   - **Create an implementation plan** --> chains to `/devt:plan`
   - **Start implementation now** --> chains to `/devt:workflow`
   - **Clarify decisions first** --> chains to `/devt:clarify`
   - **Done for now** --> saves and stops

**When to use specify vs workflow directly:**

| Situation | Command |
|---|---|
| Clear task, known approach | `/devt:workflow` directly |
| Feature idea, need to scope it | `/devt:specify` then `/devt:workflow` |
| Bug or fix | `/devt:debug` |

---

### `/devt:debug` -- Fix a bug

Systematic 4-phase debugging. No guessing, no "try this and see."

```bash
/devt:debug "tests failing on user service after migration"
/devt:debug "API returns 500 on concurrent requests to /orders"
/devt:debug "login works locally but fails in staging"
```

**What happens:**

1. Captures symptoms (expected vs actual behavior, error messages, reproduction steps)
2. Dispatches a debugger agent in fresh context with 4-phase protocol:
   - **Phase 1**: Root cause investigation (MANDATORY -- no fixes before understanding)
   - **Phase 2**: Pattern analysis (find working example, compare line-by-line)
   - **Phase 3**: Hypothesis (falsifiable, one variable at a time)
   - **Phase 4**: Fix (minimal change + tests + defense-in-depth)
3. If FIXED: appends root cause to `debug-knowledge-base.md` (future debug sessions skip re-investigation)
4. If needs more investigation: offers to re-run with accumulated context

---

### `/devt:ship` -- Create PR

Creates a pull request from completed workflow artifacts.

```bash
/devt:ship
```

**What happens:**

1. Checks preflight: git auth, not on protected branch, remote configured
2. Reads `.devt/state/` artifacts: impl-summary, test-summary, review verdict, decisions
3. Generates PR body with: summary, changes, testing, review score
4. Pushes branch and creates PR via `gh` CLI
5. Reports PR URL

---

### `/devt:next` -- What should I do?

Don't remember where you left off? Don't know which command to run? Just run next.

```bash
/devt:next
```

**What happens:**

Reads all available state and acts:

| State detected | Action |
|---|---|
| Nothing in progress | Asks what you want to do (build, specify, debug) |
| Paused workflow (handoff.json) | Resumes from where you left off |
| Spec exists, no plan | Runs `/devt:plan` |
| Plan exists, no implementation | Runs `/devt:workflow` |
| Implementation complete + approved | Offers `/devt:ship` |
| Active workflow at a phase | Continues the workflow |
| Workflow blocked | Shows the blocker, offers fix/cancel/forensics |
| Uncommitted changes, no workflow | Offers to ship |

---

## Setup

### `/devt:init` -- Initialize project

One-time setup for a new project. Scaffolds `.devt/rules/` with project conventions and creates `.devt/config.json`.

```bash
/devt:init
```

**What happens:**

1. Asks which template: `python-fastapi`, `go`, `typescript-node`, `vue-bootstrap`, `blank` (language-agnostic defaults)
2. Asks for project metadata: git provider, workspace, branch name
3. Copies template files to `.devt/rules/`
4. Creates `.devt/config.json`, `.devt/state/`, `.devt/learning-playbook.md`
5. Adds `.devt/state/` to `.gitignore`

---

### `/devt:help` -- Command reference

Show all devt commands organized by experience level with practical use cases and typical workflows.

```bash
/devt:help
```

---

### `/devt:do` -- Smart router

Describe what you want in plain text. devt matches your intent to the right command and dispatches it. Never does work itself.

```bash
/devt:do "fix the login bug"          # → routes to /devt:debug
/devt:do "add pagination to contacts" # → routes to /devt:workflow
/devt:do "what changed this week"     # → routes to /devt:weekly-report
```

---

### `/devt:session-report` -- Session summary

Generate a post-session report with commits, files changed, decisions, and outcomes. Reads from git log and `.devt/state/` artifacts.

```bash
/devt:session-report
```

---

## Utilities

Commands you call when needed, not part of the main flow.

### `/devt:status` -- Where am I?

```bash
/devt:status
```

Shows: current workflow phase, tier, iteration count, what happened so far, what's next.

### `/devt:pause` -- Save and resume later

```bash
/devt:pause
```

Creates structured handoff in `.devt/state/handoff.json`. When you start a new session, devt detects the handoff and offers to resume.

### `/devt:forensics` -- What went wrong?

```bash
/devt:forensics
```

Post-mortem for failed or stuck workflows. Reads all artifacts, checks git history, runs quality gates, diagnoses the failure point, and recommends recovery.

### `/devt:cancel-workflow` -- Reset

```bash
/devt:cancel-workflow
```

Aborts the active workflow and clears `.devt/state/`. Clean slate.

### `/devt:note` -- Quick idea capture

```bash
/devt:note "should add caching to the search endpoint later"
/devt:note --list
```

### `/devt:health` -- Plugin diagnostics

```bash
/devt:health
```

Checks: config valid, state directory exists, hooks registered, required files present.

---

## Typical Flows

### Flow 1: Quick fix

```
You: /devt:workflow "fix typo in error message for login endpoint"

devt: Assessed as TRIVIAL (1 file, no decisions).
      Fixed typo in src/auth/messages:42
      Quality gates: PASS
      Done.
```

### Flow 2: Standard feature

```
You: /devt:workflow "add health check endpoint at GET /health"

devt: Assessed as STANDARD (2 files, known pattern).
      --- Phase 1/7: Scan ---
      Found 12 relevant files, existing endpoint patterns in routes/...
      --- Phase 2/7: Implement ---
      programmer: DONE (2 files changed)
      --- Phase 3/7: Test ---
      tester: DONE (4 tests added)
      --- Phase 4/7: Review ---
      code-reviewer: APPROVED (score: 93/100)
      --- Phase 5/7: Verify ---
      verifier: VERIFIED
      --- Phase 6/7: Docs ---
      docs-writer: DONE (MODULE.md updated)
      --- Phase 7/7: Retro ---
      retro: 1 lesson extracted

      Workflow complete. 2 files changed, 4 tests, score 93/100.
```

### Flow 3: Complex feature with specify

```
You: /devt:specify "add rate limiting to public API endpoints"

devt: [Analyzes codebase: 12 public endpoints, Redis available, DI framework detected]
      [Interviews: strategy? limits? which endpoints? 429 behavior?]
      PRD written to docs/specs/rate-limiting.md
      What next? --> "Start implementation"

devt: /devt:workflow "add rate limiting to public API endpoints"
      Assessed as COMPLEX (new pattern, 10+ files, external integration).
      --- Auto-Research ---
      Researcher investigated: Redis sliding window, middleware patterns...
      --- Auto-Plan ---
      Plan: 8 tasks, 12 files to change
      Proceed? --> Yes
      --- Phase 1/10: Scan ---
      ...
      [full pipeline runs]
      ...
      Workflow complete. 12 files changed, 15 tests, score 91/100.
```

### Flow 4: Debug

```
You: /devt:debug "tests failing on user service after migration"

devt: Capturing symptoms...
      --- Dispatching debugger ---
      Phase 1 (Root Cause): Traced to missing column in migration 003
      Phase 2 (Pattern): Compared with working migration 002
      Phase 3 (Hypothesis): "Migration 003 drops NOT NULL constraint on email,
                             causing unique index to fail on empty strings"
      Phase 4 (Fix): Added NOT NULL constraint, created regression test

      FIXED. Root cause saved to debug-knowledge-base.md.
      Quality gates: PASS
```

### Flow 5: Something goes wrong

```
You: /devt:workflow "refactor authentication to use JWT"

devt: Assessed as COMPLEX... [runs]
      --- Phase 4/10: Review ---
      code-reviewer: NEEDS_WORK (score: 62/100)
      Repair: RETRY (iteration 1) -- re-dispatching programmer...
      code-reviewer: NEEDS_WORK (score: 71/100)
      Repair: DECOMPOSE (iteration 2) -- fixing isolated issues, deferring cross-cutting...
      code-reviewer: APPROVED_WITH_NOTES (score: 82/100)
      Proceeding with 2 deferred findings in scratchpad.

      Workflow complete (DONE_WITH_CONCERNS).
      Deferred: 2 findings in .devt/state/scratchpad.md
```

```
You: /devt:forensics

devt: Timeline: workflow ran 8/10 phases, stopped at verify (GAPS_FOUND)
      Root cause: JWT refresh token rotation not wired to middleware
      Recovery: fix the wiring manually, then re-run /devt:workflow
```

---

## Internal Commands (Power User)

These are called automatically by workflows. You can invoke them directly for fine-grained control.

| Command | What it does | Normally called by |
|---|---|---|
| `/devt:plan` | Create implementation plan with auto-research | `/devt:workflow` for COMPLEX tasks |
| `/devt:research` | Investigate approaches, patterns, pitfalls | `/devt:plan` when research is needed |
| `/devt:clarify` | Resolve ambiguity with interview or `--assumptions` mode | `/devt:specify` and `/devt:workflow` |
| `/devt:implement` | Code + test + review (no docs/retro) | Equivalent to `/devt:workflow` SIMPLE tier |
| `/devt:fast` | Inline execution, no subagents | Equivalent to `/devt:workflow` TRIVIAL tier |
| `/devt:review` | Standalone code review | Workflow review step |
| `/devt:quality` | Run lint, typecheck, tests | Every workflow as quality gates |
| `/devt:retro` | Extract lessons to playbook | Workflow retro step |
| `/devt:arch-health` | Architecture violation scan | Workflow architect step |
| `/devt:autoskill` | Propose plugin improvements from session patterns | Standalone or workflow autoskill step |
| `/devt:weekly-report` | Git-based contribution report | Standalone utility |
| `/devt:thread` | Cross-session context threads | Standalone utility |

---

## How Data Flows

Agents never talk to each other directly. They communicate through `.devt/state/` files:

```
specify     --> spec.md          --> programmer, tester, verifier, architect, researcher
research    --> research.md      --> programmer (approach guidance)
clarify     --> decisions.md     --> programmer, reviewer, verifier
plan        --> plan.md          --> programmer, architect, verifier
programmer  --> impl-summary.md  --> tester, reviewer, verifier, docs-writer, retro
tester      --> test-summary.md  --> reviewer, verifier, docs-writer, retro
reviewer    --> review.md        --> programmer (if NEEDS_WORK), verifier, retro
verifier    --> verification.md  --> programmer (if GAPS_FOUND)
baseline    --> baseline-gates.md --> verifier (regression detection)
architect   --> arch-review.md   --> programmer
retro       --> lessons.yaml     --> curator
curator     --> .devt/learning-playbook.md --> semantic sync --> lessons.db (FTS5)
                                    --> future workflows (queried in context_init, injected as <learning_context>)
debugger    --> debug-summary.md + debug-knowledge-base.md --> future debug sessions
```

Each agent gets a **fresh context window** -- no accumulated garbage from prior steps. The workflow reads each artifact, checks the status gate, and decides what happens next.
