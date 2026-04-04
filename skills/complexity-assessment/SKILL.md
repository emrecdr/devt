---
name: complexity-assessment
description: >-
  Use to assess how big or complex a task is BEFORE starting work — scores 5 dimensions (scope,
  integration, infrastructure, dependencies, risk) to determine the tier (SIMPLE/STANDARD/COMPLEX) and
  match the right workflow depth. Trigger on "how complex is this", "assess the scope", "what tier",
  "is this a big change", "estimate effort", "how big of a change is this really", "is this a one-day
  thing or a full sprint", "can I knock this out in an afternoon", "do we need a plan for this", "sounds
  simple but", "bigger than it looks", "quantify the scope", "score the dimensions", "SIMPLE or COMPLEX",
  "what workflow should we use", "realistic assessment of the scope", "before anyone touches code I need
  to understand the size", "how should we approach this." This is about SIZING a task before starting —
  not about choosing between implementation approaches (use strategic-analysis), not about reviewing
  finished code (use code-review-guide), and not about scanning for existing code (use codebase-scan).
---

# Complexity Assessment

## Overview

Every task has a complexity tier that determines how much planning, review, and testing it requires. Assess complexity before starting work, not after discovering it mid-implementation.

Underestimating complexity causes missed edge cases, incomplete implementations, and rework. Overestimating causes over-engineering. This skill provides an objective scoring method.

## When NOT to Use

Skip for tasks the user has already scoped (e.g., "just fix this typo") or when the tier is explicitly set.

## The Iron Law

```
NO WORK STARTS WITHOUT A TIER ASSESSMENT
```

Tasks that skip complexity assessment often start with the wrong workflow tier — a COMPLEX task runs through SIMPLE steps and produces incomplete results, or a SIMPLE task gets buried under unnecessary architect reviews and planning overhead. The 30-second assessment saves hours of wasted effort by matching the workflow's depth to the task's actual scope.

Skipping assessment is the slowest path — you discover complexity through failure instead of scoring. Two minutes of scoring prevents hours of rework.

## The Process

### Step 1: Identify the 5 Dimensions

Score each dimension from 1 (low) to 3 (high).

#### Dimension 1: Scope

How much code changes?

| Score | Criteria                                            |
| ----- | --------------------------------------------------- |
| 1     | Single file or function. Localized change.          |
| 2     | Multiple files in one module. One service boundary. |
| 3     | Multiple modules or services. Structural changes.   |

#### Dimension 2: Integration

How many system boundaries are crossed?

| Score | Criteria                                                             |
| ----- | -------------------------------------------------------------------- |
| 1     | No integration. Self-contained change.                               |
| 2     | One integration point. Internal API or shared interface.             |
| 3     | Multiple integration points. External APIs, cross-service contracts. |

#### Dimension 3: Infrastructure

Are there infrastructure changes?

| Score | Criteria                                               |
| ----- | ------------------------------------------------------ |
| 1     | No infrastructure changes. Code only.                  |
| 2     | Configuration changes. New env vars, feature flags.    |
| 3     | Database migrations, deployment changes, new services. |

#### Dimension 4: Dependencies

How many existing systems must be understood?

| Score | Criteria                                                            |
| ----- | ------------------------------------------------------------------- |
| 1     | Standalone. Minimal existing code to understand.                    |
| 2     | Depends on 1-2 existing modules. Must understand their contracts.   |
| 3     | Depends on 3+ modules. Deep understanding of interactions required. |

#### Dimension 5: Risk

What breaks if this goes wrong?

| Score | Criteria                                                             |
| ----- | -------------------------------------------------------------------- |
| 1     | Low risk. Easily reversible. No data impact.                         |
| 2     | Medium risk. Affects existing functionality. Reversible with effort. |
| 3     | High risk. Data migrations, security changes, breaking API changes.  |

### Step 2: Calculate Total Score

Sum all 5 dimensions (range: 5-15). Tasks scoring below 5 are TRIVIAL (1-4 indicates at least one dimension was scored 0 by the assessor for non-applicability, e.g., zero risk, zero dependencies).

### Step 3: Determine Tier

| Total | Tier         | Workflow Implications                                                                |
| ----- | ------------ | ------------------------------------------------------------------------------------ |
| 1-4   | **TRIVIAL**  | Single-file change, no integration, no tests needed. Inline execution, no subagents. |
| 5-7   | **SIMPLE**   | Direct implementation. Minimal review. Unit tests sufficient.                        |
| 8-12  | **STANDARD** | Plan before implementing. Full review. Unit + integration tests.                     |
| 13-15 | **COMPLEX**  | Strategic analysis required. Multi-phase plan. All test levels. Architecture review. |

### Step 4: Load Keywords (Optional)

Check `assets/keywords.yaml` for signal words in the task description that indicate higher complexity. Adjust scores if keywords suggest a dimension was underscored.

### Step 5: Document Assessment

Record the assessment in a structured format:

```
Complexity: STANDARD (10/15)
  Scope:          2 — Multiple files in identity module
  Integration:    2 — Touches auth + user services
  Infrastructure: 2 — New database migration
  Dependencies:   2 — Must understand RBAC system
  Risk:           2 — Changes auth behavior
```

### Scored Example

**Task**: "Add rate limiting to the API gateway"

| Dimension      | Score | Reasoning                                       |
| -------------- | ----- | ----------------------------------------------- |
| Scope          | 2     | Touches 3-4 files (middleware, config, tests)   |
| Integration    | 2     | Cross-cutting concern affecting all routes      |
| Infrastructure | 1     | No new infrastructure, uses existing Redis      |
| Dependencies   | 2     | Interacts with auth middleware, logging, config |
| Risk           | 2     | Could block legitimate users if misconfigured   |
| **Total**      | **9** | **-> STANDARD** (threshold: 8-12)               |

## Gate: Tier-Workflow Match

The selected workflow must match the tier:

- [ ] SIMPLE tasks do not trigger full architecture reviews
- [ ] COMPLEX tasks do not skip strategic analysis
- [ ] STANDARD tasks include review but not necessarily multi-phase planning

## Self-test

After scoring, verify: Could a junior developer understand the scope from your tier label? If not, re-evaluate. The tier should communicate enough about the task's weight that someone unfamiliar with the codebase can anticipate the level of effort involved.

## Anti-patterns

| Don't                                    | Why It Fails                                                                       | Do Instead                                         |
| ---------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------- |
| "This is simple, let's just do it"       | Your intuition skips dimensions you haven't considered                             | Score all 5 dimensions first                       |
| "I'll figure out the complexity as I go" | That is how scope creep starts                                                     | Assess before implementing                         |
| "The user said it's simple"              | The user describes what they want, not implementation complexity                   | Score based on codebase reality                    |
| "It's only one file"                     | One file can have high risk and deep dependencies                                  | Score risk and dependencies independently of scope |
| "I've done this before"                  | Past experience does not reduce current task complexity                            | Score the task, not your familiarity               |
| "It's just adding a field"               | A field that touches DB, API, DTOs, tests, and docs is not "just"                  | Trace the field through all layers                 |
| "Let's skip assessment for speed"        | Skipping assessment is the slowest path -- you discover complexity through failure | 2 minutes of scoring prevents hours of rework      |

## Integration

- **Prerequisites**: codebase-scan (scan results inform scope and dependency scores)
- **Feeds into**: Workflow selection (TRIVIAL/SIMPLE/STANDARD/COMPLEX determines agent involvement)
- **Used by agents**: workflow orchestrator (to plan workflows), architect (to validate scope)
- **Assets**: `assets/keywords.yaml` — signal words by dimension
