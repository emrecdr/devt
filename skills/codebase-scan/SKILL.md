---
name: codebase-scan
description: >-
  MANDATORY before writing any new code. Scan the codebase for existing implementations, reusable utilities,
  and established patterns to prevent duplication. Use whenever the user says "check if similar exists",
  "before I build/create/add/implement", "search for existing", "look for reusable code", "find what we
  already have", "is there already a", "don't want to duplicate", "explore the codebase", "what utilities
  exist", "scan for patterns", "any existing code for", "check utils/shared/helpers", "extend instead of
  building from scratch", "look around first", "see if we already have", or any variant of "before I start,
  find what exists." Also triggers on "investigate how X works", "find where X is used", "what conventions
  does the project follow." This is about DISCOVERING existing code before creating new code — not about
  reviewing code quality (use code-review-guide), not about verifying completeness of finished work (use
  verification-patterns), and not about assessing task size (use complexity-assessment).
---

# Codebase Scan

## Overview

Search before you build. Every new implementation must be preceded by a thorough scan for existing code that already solves the problem, partially solves it, or establishes a pattern you must follow.

Skipping this step is the single most common cause of duplicate code, inconsistent patterns, and wasted effort. A 5-minute scan prevents hours of rework.

## When NOT to Use

Skip when the task explicitly names all files to modify and no discovery is needed.

## Time Budget

- **Focused scan** (known area): 1-2 minutes
- **Broad exploration** (unfamiliar codebase): 3-5 minutes

## The Iron Law

```
NO NEW CODE WITHOUT SCANNING FOR EXISTING ALTERNATIVES FIRST
```

If you haven't run all 4 search steps, you cannot claim "nothing exists." Duplication is the most common implementation failure — a 5-minute scan prevents hours of rework.

Without scanning first, agents frequently duplicate existing functionality, creating maintenance burden and inconsistency. The scan also reveals naming conventions, architectural patterns, and reusable utilities that improve implementation quality. Duplication is the single most common form of generative debt.

## The Process

### Step 1: Search by Name

Search for the exact name or close variations of what you plan to create.

```
Grep: class FeatureName, def feature_name, FeatureNameService
Glob: **/*feature_name*
```

If found, stop. Use or extend the existing implementation.

### Step 2: Search by Concept

Search for synonyms, related terms, and the domain concept.

```
Grep: "license", "licence", "activation", "trial"
Grep: the business term, not the technical term
```

Different developers name things differently. A "notification" might be called "alert", "message", or "event".

### Step 3: Search by Pattern

Search for the structural pattern you plan to implement.

```
Grep: Protocol, Interface, Repository, Service — in the same domain
Glob: **/repository_interfaces*, **/errors*, **/dto*
```

Understand the existing conventions before adding your own.

### Step 4: Check Tests

Tests reveal intent and usage patterns that code alone may not.

```
Glob: **/tests/**/test_*feature*
Grep: "def test_.*feature" in test files
```

Existing tests tell you what behavior is already covered and expected.

### Step 5: Report Findings

Before writing any code, summarize:

- **Exists**: Found exact match — reuse it
- **Partial match**: Found related code — extend it
- **Pattern established**: Found convention to follow — follow it
- **Truly new**: Nothing found — proceed with implementation

### Search Strategy Example

**Searching for: "user notification system"**

1. Search by name: `Grep "notification"` -> finds NotificationService
2. Search by concept: `Grep "send.*email|push.*message|alert"` -> finds email_sender, push_service
3. Search by pattern: look in service layer for anything that dispatches messages -> finds event_bus
4. Check tests: `Glob **/test*notif* **/notification*test*` -> reveals existing test coverage

Each search layer finds things the others miss. Skip none.

## Gate: No Duplicates

If the scan found existing code:

- [ ] Confirmed the existing code does not already solve the problem
- [ ] Confirmed extending existing code is not feasible
- [ ] Justified why new code is needed despite existing alternatives

## Anti-patterns

| Don't                                       | Why It Fails                                       | Do Instead                                              |
| ------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------- |
| "I already know the codebase"               | You do not. Memory is selective and stale.         | Search anyway -- prove it with results                  |
| "This is definitely new"                    | Unproven assumptions create duplicates             | Show search results for name, concept, and pattern      |
| "I'll just create a quick version"          | Quick versions become permanent duplicates         | Search first, create only if truly new                  |
| "The existing one is different enough"      | "Different enough" is not quantified               | State exactly what differs and why reuse fails          |
| "I'll refactor later to deduplicate"        | No you will not. Deduplicate now.                  | Extend or fix existing code before creating new         |
| "I searched and found nothing"              | Searched by name only, not by concept or pattern   | Run all 4 search steps before declaring "nothing found" |
| "The existing one is in a different module" | Cross-module reuse is the entire point of scanning | Import from the owning module                           |
| "The existing implementation is bad"        | Two bad versions is worse than one fixed version   | Fix the existing code. Do not fork it.                  |

## Regex Cheat Sheet

Common search patterns for codebase scanning:

| Pattern | Matches |
| --- | --- |
| `function\s+\w+` | Function declarations |
| `class\s+\w+` | Class declarations |
| `export\s+(default\|const)` | ES module exports |
| `import.*from` | ES module imports |
| `def\s+\w+` | Python function definitions |
| `interface\s+\w+` | Interface declarations |

## Integration

- **Prerequisites**: None — this is the first skill in any implementation workflow
- **Feeds into**: complexity-assessment (scan results inform scope), strategic-analysis (findings shape options)
- **Used by agents**: programmer, architect, code-reviewer (to verify no duplication was introduced)
