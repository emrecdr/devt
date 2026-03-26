---
name: code-review-guide
description: Use when reviewing code for quality, security, and architecture compliance. Provides scoring framework (start at 100, deduct for issues) and verdict system (APPROVED/APPROVED_WITH_NOTES/NEEDS_WORK). Trigger on 'review', 'check this code', 'is this ready', 'code quality', 'PR review', or after any implementation is marked complete.
---

# Code Review Guide

## Overview

A code review is a structured inspection that produces a scored assessment with specific, actionable findings. Every finding must reference a concrete location, describe the problem, explain the impact, and suggest a fix.

Reviews are objective. They evaluate code against documented project standards, not personal preferences. If a standard does not exist for something, it is not a finding.

**Precision mandate**: Every finding must name a specific file, line number, and exact violation. If a finding could apply to any codebase, it is too vague to report.

## When to Use

- Before approving any pull request or merge
- After implementation is complete, before marking done
- When asked to evaluate code quality
- During post-incident reviews of code that caused issues

## The Process

### Step 1: Load Standards

Before reviewing any code, read the project's rules:

1. `.dev-rules/coding-standards.md` — code conventions
2. `.dev-rules/architecture.md` — structural boundaries
3. `.dev-rules/quality-gates.md` — pass/fail criteria
4. `CLAUDE.md` — project-specific rules

A review without loaded standards is a review against personal opinion. Do not start reviewing until all applicable standards are loaded.

### Step 2: Understand Scope

Read the implementation summary or PR description:

- What files were changed and why
- What the acceptance criteria are
- What the intended behavior is

This sets context but does not limit findings. Issues found outside the stated scope are still valid.

### Step 3: Review by Category

Evaluate each changed file against these categories:

#### Architecture (weight: high)

- Layer boundaries respected (domain has no infrastructure imports)
- Dependency direction correct (inner layers do not depend on outer)
- Separation of concerns (routes are thin, services hold logic)
- No circular dependencies
- Repository pattern followed (services use interfaces, not sessions)

#### Security (weight: critical)

- Input validation present (schema validation, type safety)
- Authentication/authorization checks in place
- No secrets in code or logs
- SQL injection prevention (parameterized queries)
- No data exposure in error responses

#### Performance (weight: medium)

- No N+1 query patterns
- No unnecessary database round-trips
- Appropriate use of async/sync
- No unbounded queries (missing pagination/limits)

#### Error Handling (weight: high)

- Custom errors inherit from base error classes (not plain Exception)
- No swallowed exceptions (bare except or except Exception: pass)
- Errors carry enough context for debugging
- Graceful degradation where appropriate

#### Test Coverage (weight: high)

- New code has corresponding tests
- Edge cases covered (empty input, null, boundary values)
- Tests are independent and deterministic
- Test names describe behavior, not implementation

#### Code Quality (weight: medium)

- Clear naming (variables, functions, classes)
- No deep nesting (3+ levels)
- Early returns used for guard clauses
- No duplication (DRY)
- No dead code, commented-out code, or TODOs
- Type hints present on all function signatures

### Step 4: Score Each Finding

Every finding gets a severity:

| Severity | Point Deduction | Criteria |
|----------|----------------|----------|
| **Critical** | -15 | Security vulnerability, data loss risk, architectural violation, broken functionality |
| **Important** | -7 | Missing error handling, missing tests, performance issue, inconsistent pattern |
| **Minor** | -3 | Naming issue, style inconsistency, missing type hint, documentation gap |

### Step 5: Calculate Score

```
Starting score: 100
Final score: 100 - sum(deductions)
Minimum: 0
```

### Step 6: Determine Verdict

| Score | Verdict | Meaning |
|-------|---------|---------|
| >= 90 | **APPROVED** | Ship it. Minor issues can be addressed later. |
| 80-89 | **APPROVED_WITH_NOTES** | Acceptable but has important findings to address. |
| < 80 | **NEEDS_WORK** | Must fix critical/important findings before proceeding. |

### Step 7: Write Report

Structure the report as:

```
## Review Summary
Score: XX/100 — VERDICT

## Findings

### [Critical] File:Line — Short description
**Problem**: What is wrong
**Impact**: Why it matters
**Fix**: What to do

### [Important] File:Line — Short description
...
```

### Scoring Examples

**Critical finding (-15)**:
- PASS: "SQL injection in `users.py:47` -- user input concatenated into query string without parameterization"
- FAIL: "Possible security issue" (too vague -- name the file, line, exact problem)

**Important finding (-7)**:
- PASS: "Missing error handling in `payment_service.py:89` -- API call to Stripe has no try/except, will crash on network timeout"
- FAIL: "Error handling could be better" (unactionable)

**Minor finding (-3)**:
- PASS: "Inconsistent naming: `getUserData()` at `api.py:23` but `fetch_user_info()` at `api.py:67` -- pick one convention"
- FAIL: "Naming is inconsistent" (where? what? be specific)

## Gate: Honest Scoring

- [ ] No findings dismissed as "acceptable" or "pre-existing"
- [ ] Deductions applied consistently across findings
- [ ] Verdict matches the score (no manual override)

## Anti-patterns

| Don't | Why It Fails | Do Instead |
|-------|-------------|------------|
| Skip review because "it's simple" | Simple code has simple bugs that reach production | Review everything, even one-liners |
| Accept "it works" as sufficient | Working code can be insecure, unmaintainable, or wrong | Check quality dimensions, not just functionality |
| Label findings as "pre-existing" | Origin is irrelevant -- if it's visible, it's your responsibility | Report every finding. No origin column. |
| Rate "close enough" as APPROVED | Partial compliance becomes full non-compliance over time | Score honestly. 78 is NEEDS_WORK, not 80. |
| Skip security checks for internal code | Internal code gets promoted to external. Supply chain attacks hit internals. | Full security checklist every time |
| Say "the tests pass so it's fine" | Passing tests prove tests pass, not that code is correct | Evaluate all 6 categories, not just functionality |
| Dismiss "it follows the existing pattern" | If the pattern is wrong, it is still a finding | Report it. Consistency with bad patterns is not a defense |
| Soften scores because "flagging this is harsh" | Accuracy is not harshness | Apply deductions by severity criteria, not by feelings |

## Integration

- **Prerequisites**: Standards files must exist in `.dev-rules/`
- **Used by agents**: code-reviewer (primary consumer)
- **Related skills**: codebase-scan (to verify no duplication introduced), architecture-health-scanner (for systemic issues)
