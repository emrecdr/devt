---
name: codebase-scan
description: Use when about to implement a new feature or fix a bug — scan for existing code, patterns, and duplicates before writing anything. Also use when investigating unfamiliar parts of the codebase. Trigger whenever the user says 'create', 'add', 'implement', 'build', or 'new' for any code artifact, or 'investigate', 'explore', 'find where', 'how does X work'.
---

# Codebase Scan

## Overview

Search before you build. Every new implementation must be preceded by a thorough scan for existing code that already solves the problem, partially solves it, or establishes a pattern you must follow.

Skipping this step is the single most common cause of duplicate code, inconsistent patterns, and wasted effort. A 5-minute scan prevents hours of rework.

## When to Use

- Before implementing any new feature, class, function, or pattern
- Before creating any new file (the file or its equivalent may already exist)
- Before defining a new interface, protocol, or error type
- When a task says "create" or "add" — verify it does not already exist
- When fixing a bug — find all occurrences of the same pattern

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
Glob: **/repository_interfaces.py, **/errors.py, **/dto.py
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
1. Search by name: `Grep "notification" --include="*.py"` -> finds NotificationService
2. Search by concept: `Grep "send.*email|push.*message|alert"` -> finds email_sender.py, push_service.py
3. Search by pattern: look in service layer for anything that dispatches messages -> finds event_bus.py
4. Check tests: `Glob **/test_notif* **/notification*test*` -> reveals existing test coverage

Each search layer finds things the others miss. Skip none.

## Gate: No Duplicates

If the scan found existing code:

- [ ] Confirmed the existing code does not already solve the problem
- [ ] Confirmed extending existing code is not feasible
- [ ] Justified why new code is needed despite existing alternatives

## Anti-patterns

| Don't | Why It Fails | Do Instead |
|-------|-------------|------------|
| "I already know the codebase" | You do not. Memory is selective and stale. | Search anyway -- prove it with results |
| "This is definitely new" | Unproven assumptions create duplicates | Show search results for name, concept, and pattern |
| "I'll just create a quick version" | Quick versions become permanent duplicates | Search first, create only if truly new |
| "The existing one is different enough" | "Different enough" is not quantified | State exactly what differs and why reuse fails |
| "I'll refactor later to deduplicate" | No you will not. Deduplicate now. | Extend or fix existing code before creating new |
| "I searched and found nothing" | Searched by name only, not by concept or pattern | Run all 4 search steps before declaring "nothing found" |
| "The existing one is in a different module" | Cross-module reuse is the entire point of scanning | Import from the owning module |
| "The existing implementation is bad" | Two bad versions is worse than one fixed version | Fix the existing code. Do not fork it. |

## Integration

- **Prerequisites**: None — this is the first skill in any implementation workflow
- **Feeds into**: complexity-assessment (scan results inform scope), strategic-analysis (findings shape options)
- **Used by agents**: programmer, architect, code-reviewer (to verify no duplication was introduced)
