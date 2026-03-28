# Golden Rules

> Non-negotiable rules for all development work. Violations require immediate stop and correction.

## Quick Reference Card

| Rule | One-Liner |
|------|-----------|
| 1. Deep Analysis | Scan ALL related code BEFORE implementing |
| 2. No Duplicates | NEVER reimplement existing features or utilities |
| 3. No Backward Compat | Don't add legacy shims — update callers directly |
| 4. Boy Scout | Leave code CLEANER than you found it |
| 5. No TODOs/Markers | Complete code only — no placeholders |
| 6. Verify Before Done | No completion claims without test evidence |

---

## Rule 1: Deep Analysis Before Implementation

```
NO IMPLEMENTATION WITHOUT CODEBASE SCAN. NO EXCEPTIONS.
```

### Required Process

Before ANY implementation work:

1. **Scan target module**: Read existing files in the target area
2. **Scan shared utilities**: Check for helpers that already solve your subproblem
3. **Scan tests**: Existing tests reveal actual behavior, not just intent

### Violation Examples

- Implementing a helper that already exists in the codebase
- Creating a new wrapper when the project already has one
- Adding a new error type when an existing one covers the case

---

## Rule 2: No Duplicate Features

Search before creating. If a function, type, or pattern already exists — reuse it. If it doesn't fit exactly, extend it. Creating a parallel implementation is always wrong.

---

## Rule 3: No Backward Compatibility Code

Prefer direct changes over compatibility layers. No:

- Deprecated function aliases
- Feature flags for old behavior
- Compatibility shims between old and new APIs

Change the code, update all callers, delete the old path. If the project has external consumers, coordinate breaking changes — but don't add shims within the codebase itself.

---

## Rule 4: Boy Scout Rule

Every commit leaves the codebase cleaner:

- Remove dead code you encounter
- Fix linter warnings in files you touch
- Simplify overly complex conditions in code you read
- Update stale comments in functions you modify

---

## Rule 5: No TODOs or Placeholders

Ship complete code or don't ship. If you can't complete a function, surface it as BLOCKED in your summary.

---

## Rule 6: Verify Before Claiming Done

Before reporting DONE, run the project's quality gates and copy the terminal output as evidence. "I believe the tests pass" is not verification — "Here is the output showing 0 failures" is.
