---
name: lesson-extraction
description: Capture lessons from completed work — what went wrong, what worked, non-obvious discoveries, and patterns worth remembering. Produces structured LEARN entries with importance/confidence/decay scoring for the learning playbook. Trigger on 'what did we learn', 'record this', 'remember this for next time', 'that was a mistake', 'capture this lesson', 'write this down', 'before we close out, capture that...', 'extract the lessons from this session', 'key takeaway', 'big discovery today', 'that debugging session taught us', 'we need to remember this pattern', or any end-of-session reflection on what happened and why. Also trigger when the user describes a specific incident or bug root cause and wants it preserved for future reference — e.g. 'the real fix was X not Y', 'this is a landmine worth recording', 'that gave us false greens'. This skill writes knowledge TO the playbook — it does NOT search/query the playbook (use semantic search), does NOT prune/archive stale entries (use memory-compaction), and does NOT improve the plugin system itself (use autoskill for rule/skill/agent changes).
allowed-tools: Bash Read Write Edit Grep Glob
---

# Lesson Extraction

## Overview

Every completed task contains lessons that can prevent future mistakes or accelerate future work. Extraction captures these lessons in a structured format that makes them searchable, scorable, and expirable.

The goal is not to document everything. It is to capture lessons that are specific enough to be actionable, general enough to be reusable, and evidence-based enough to be trustworthy.

## The Iron Law

```
ALL 4 QUALITY FILTERS MUST PASS — NO PARTIAL CREDIT
```

The learning playbook is only valuable if entries are actionable and generalizable. Without quality filters, it accumulates vague observations ("tests are important"), project-specific trivia, and gut feelings that dilute the signal. Each filter catches a different failure mode — specificity prevents vagueness, generalizability prevents overfitting, actionability prevents philosophy, and evidence prevents speculation.

A candidate that fails ANY filter (specific, generalizable, actionable, evidence-based) is discarded. Better to extract 2 strong lessons than 10 weak ones.

## The Process

### Step 1: Identify Candidates

Review the completed work and look for:

- **Mistakes made**: What went wrong and why
- **Non-obvious solutions**: Fixes that required investigation to find
- **Patterns discovered**: Conventions or approaches that worked well
- **Time sinks**: Steps that took longer than expected and why
- **Corrections received**: Feedback from the user that changed approach

### Step 2: Draft LEARN Entry

Each lesson uses this YAML format:

```yaml
- description: |
    Clear, actionable description of the lesson.
    Include the context, the problem, and the solution.
  category: architecture | coding | testing | tooling | process | debugging
  importance: 7 # 1-10, how impactful is this lesson
  confidence: 0.8 # 0.0-1.0, how certain are you this is correct
  decay_days: 180 # days before this lesson should be re-evaluated
  tags: [error-handling, repository-pattern, data-access]
  evidence: |
    Concrete evidence from the session: file paths, error messages,
    the specific situation that produced this lesson.
```

### Step 3: Apply Quality Filters

Every entry MUST pass all 4 filters before being accepted:

#### Filter 1: Specific (not vague)

- PASS: "ORM relationships require explicit back-references on both sides; omitting one causes silent query failures where related objects return empty lists"
- FAIL: "Be careful with ORMs"

#### Filter 2: Generalizable (not one-off)

- PASS: "When a route handler catches generic `Exception` before custom app errors, those custom errors get swallowed and return 500 instead of their mapped status code"
- FAIL: "The user_service file on line 47 has a bug"

#### Filter 3: Actionable (not observation)

- PASS: "Always search for existing interfaces before creating a new one — duplicates cause dependency injection conflicts"
- FAIL: "The codebase has a lot of interfaces"

#### Filter 4: Evidence-based (not theoretical)

- PASS: "Confirmed by incident: missing `email_status_logs` cleanup in `delete_hard()` caused FK constraint violation on user deletion (file: user_repository)"
- FAIL: "FK constraints could theoretically cause issues during deletion"

### Step 4: Calibrate Scores

#### Importance (1-10)

| Score | Criteria                                                    |
| ----- | ----------------------------------------------------------- |
| 1-3   | Nice to know. Minor convenience.                            |
| 4-6   | Saves meaningful time or prevents common mistakes.          |
| 7-8   | Prevents significant bugs or architectural issues.          |
| 9-10  | Prevents data loss, security issues, or hours of debugging. |

#### Confidence (0.0-1.0)

| Score   | Criteria                                                      |
| ------- | ------------------------------------------------------------- |
| 0.0-0.3 | Hypothesis. Not fully validated.                              |
| 0.4-0.6 | Observed once. Likely correct but needs more evidence.        |
| 0.7-0.8 | Observed multiple times. Well-understood mechanism.           |
| 0.9-1.0 | Proven. Documented in official sources or extensively tested. |

#### Decay Days

| Duration | When to use                                                     |
| -------- | --------------------------------------------------------------- |
| 30-60    | Tooling-specific, version-dependent (may change with updates)   |
| 90-180   | Framework patterns, architectural lessons (stable but evolving) |
| 365+     | Fundamental principles (rarely change)                          |

**Calibration examples:**

- **30 days** — Tool quirk: "`pytest --no-header` suppresses the version line but also hides the rootdir — use `--no-header -rN` to keep rootdir visible"
- **90 days** — Testing pattern: "Use real database for repository integration tests, mocks for service-layer unit tests — mixing the two causes false green tests"
- **180 days** — Architecture decision: "Event-driven communication between bounded contexts prevents cascading failures; synchronous calls between services couple deployment schedules"
- **365 days** — Fundamental principle: "Never mutate shared state across concurrent operations — always copy-on-write or use immutable data structures"

### Step 5: Write to Playbook

Append the validated entries to the learning playbook file. If the playbook does not exist, create it.

## Gate Functions

### Gate: Quality Filters Passed

Every entry must pass ALL 4 filters:

- [ ] Specific — describes a concrete situation and solution
- [ ] Generalizable — applies beyond the single instance
- [ ] Actionable — tells you what to do, not just what exists
- [ ] Evidence-based — cites the actual session/incident/code

If any filter fails, rewrite the entry or discard it.

### Gate: Scores Calibrated

- [ ] Importance reflects actual impact, not perceived effort
- [ ] Confidence reflects evidence strength, not gut feeling
- [ ] Decay days match the lesson's expected shelf life

## When NOT to Use

Skip for sessions with no implementation, no bugs, and no surprises — not every session produces lessons. If the work was routine application of known patterns with no unexpected outcomes, there is nothing to extract. Forcing extraction on uneventful sessions produces low-quality entries that clutter the playbook.

## Time Budget

- **Extraction** (Steps 1-2): 2-3 minutes
- **Quality filtering and score calibration** (Steps 3-4): 1-2 minutes

## Anti-patterns

| Anti-pattern | Why it fails | Instead |
| --- | --- | --- |
| "Everything I did today is a lesson" | Most work is routine, not reusable insight | Extract only what prevents future mistakes |
| "This is important but I can't explain why" | Inarticulate lessons are not ready to record | Clarify the lesson until it is specific and actionable |
| "Everyone knows this" | If everyone knew it, the mistake would not have happened | Record it with evidence |
| "This is too specific to our project" | The specific example is evidence; the principle generalizes | Extract the general principle |
| "This is obvious" | Obvious lessons still get violated | If it caused a bug, record it |
| "I'll remember this" | You will not. In 3 months, you will make the same mistake. | Write it down with evidence and decay date |
| "The lesson is just 'be more careful'" | That is not a lesson | Identify the specific check that would have caught it |

## Integration

- **Prerequisites**: Completed work to extract from
- **Feeds into**: playbook-curation (entries are curated for quality), semantic-search (entries become queryable)
- **Used by agents**: retro (primary extraction agent), all agents (can extract lessons from their work)
- **Related skills**: playbook-curation (maintains lesson quality), memory-compaction (archives stale lessons)
