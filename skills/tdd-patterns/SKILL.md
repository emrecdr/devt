---
name: tdd-patterns
description: Use when the user wants to write code using test-driven development — writing the failing test BEFORE any production code. Enforces the RED-GREEN-REFACTOR cycle with mandatory verification gates. Trigger on 'TDD', 'test first', 'test-first', 'write the test before the code', 'failing test first', 'red-green-refactor', 'start with a red test', 'write a failing test that reproduces the bug before fixing', 'let us TDD this', 'test-driven', or when implementing critical business logic where specification correctness matters. This is for writing NEW tests BEFORE new code (test-first workflow), NOT for debugging existing failing tests, NOT for adding test coverage after the fact, NOT for reviewing or fixing existing test files, NOT for running test suites, and NOT for writing tests after implementation (test-after is not TDD).
allowed-tools: Bash Read Write Edit Grep Glob
paths:
  - "**/test_*.py"
  - "**/*_test.py"
  - "**/*.test.*"
  - "**/*.spec.*"
  - "**/*_test.go"
  - "**/test/**"
  - "**/tests/**"
  - "**/spec/**"
---

# TDD Patterns

## Overview

Test-Driven Development writes the test BEFORE the implementation. This catches different bugs than test-after — it verifies the specification is correct, not just that the code runs.

## The Iron Law

```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
```

The RED-GREEN-REFACTOR cycle exists because tests written after implementation are biased toward confirming what was built, not what was required. A failing test written first defines the specification — the implementation serves the test, not the other way around. Skipping RED (writing a passing test first) means you cannot distinguish between a test that validates behavior and one that simply mirrors implementation.

If you wrote code before the test, delete it and start over. Tests written after implementation prove the code runs, not that it is correct.

## The Cycle

### RED: Write Failing Test

1. Read the specification/requirements
2. Write a test that captures the expected behavior
3. Run the test
4. **GATE: Test MUST fail.** If it passes:
   - The feature already exists → investigate before proceeding
   - The test is wrong → fix the test, not the code
   - NEVER proceed to GREEN with a passing test

### GREEN: Make It Pass

1. Write the MINIMAL code to make the test pass
2. No cleverness. No future-proofing. Just pass the test.
3. Run the test
4. **GATE: Test MUST pass.** If it fails after 3 attempts → BLOCKED

### REFACTOR: Clean Up (only if needed)

1. Improve the code (naming, structure, DRY)
2. Run the test
3. **GATE: Test MUST still pass.** If it breaks → undo the refactor

## Examples

### RED: Good vs Bad Test

**Good** — tests real behavior with clear assertion:
```
test "rejects duplicate email":
    repo.create(User(email="a@b.com"))
    expect_error(ConflictError):
        repo.create(User(email="a@b.com"))
```
Clear name, tests actual behavior, one specific scenario.

**Bad** — tests mock wiring, proves nothing about production code:
```
test "create user" (mock_repo):
    service.create_user(data)
    assert mock_repo.create was called once with (data)
```
Tests that mock was called, not that user was created.

### GREEN: Minimal vs Over-Engineered

**Good** — just enough to pass the test:
```
validate_email(email):
    return "@" in email and "." in domain_part(email)
```

**Bad** — YAGNI, future-proofing before tests demand it:
```
validate_email(email, allow_subdomains=true, custom_tlds=null, strict_mode=false):
    // Over-engineered before any test requires these features
```

### Complete Bug Fix Cycle

**Bug**: Empty password accepted during registration.

**RED**:
```
test "rejects empty password":
    result = register_user(email="a@b.com", password="")
    assert result.error == "Password required"
```
Run → FAIL (empty password accepted). Good — test catches the bug.

**GREEN**:
```
register_user(email, password):
    if password is blank:
        return Error("Password required")
    // ... existing logic
```
Run → PASS.

**REFACTOR**: Extract validation if multiple fields need it. Run → still PASS.

## Commit Pattern

Each cycle = 2-3 commits:

1. `test: add failing test for [behavior]` (RED)
2. `feat: implement [behavior]` (GREEN)
3. `refactor: clean up [behavior]` (only if refactored)

## Anti-patterns

| Anti-pattern | Why it fails | Instead |
| --- | --- | --- |
| "I'll write the test after" | That is not TDD -- you lose the specification benefit | RED comes first. Always. |
| "Let me just code this up, then test" | Coding-first tests confirm implementation, not specification | Write the test before any production code |
| "The test already passes" | Either the feature exists or the test is wrong | Investigate before proceeding to GREEN |
| "Delete the old test? But I spent time on it" | Sunk cost. Wrong tests are worse than no tests. | If it is wrong, delete it |
| "This is too simple for TDD" | Simple code benefits most from TDD -- fast cycle, clear spec | Use TDD especially for simple code |
| "I know what I'm building" | TDD tests your understanding, not your confidence | Let the failing test prove your understanding |
| "Tests slow me down" | TDD prevents debugging later. Net time saved. | Invest the time upfront |
| "I'll keep the code as reference" | You will adapt it -- that is coding-first, not TDD | Delete and start RED |
| "Test-after achieves the same" | Test-after asks "does my code work?" TDD asks "does my spec work?" | Different questions, different bugs caught |

## Verification Checklist

Before marking TDD work as DONE, ALL must be true:

- [ ] Every new function/method has a test
- [ ] Watched each test fail before implementing (RED verified)
- [ ] Each test failed for the expected reason (feature missing, not typo)
- [ ] Wrote minimal code to pass each test (no YAGNI)
- [ ] All tests pass (fresh run, not cached)
- [ ] Output is pristine (no errors, no warnings, no skips)
- [ ] Tests use real code (mocks only at boundaries)
- [ ] Edge cases and error paths covered

Can't check all boxes? You skipped TDD. Start over.

## When Stuck

| Problem | Solution |
|---------|----------|
| Don't know how to test | Write the wished-for API first. Write the assertion before the setup. |
| Test is too complicated | The design is too complicated. Simplify the interface. |
| Must mock everything | Code is too coupled. Use dependency injection. |
| Test setup is huge | Extract test helpers/factories. Still complex? Simplify the design. |
| Test passes immediately | Feature already exists OR test is wrong. Investigate before proceeding. |
| GREEN fails after 3 attempts | Report BLOCKED — specification may be unclear. |

## Property-Based Testing

For functions with mathematical properties (commutative, idempotent, reversible), consider property-based tests alongside example-based TDD. Libraries: fast-check (JS), hypothesis (Python), rapid (Go).

## When NOT to Use

Skip for pure UI changes (styling, layout) where visual testing is more appropriate, or for configuration-only changes.

## Time Budget

One RED-GREEN-REFACTOR cycle: 3-5 minutes. Full TDD for a feature: scales with complexity.

## Debugging Integration

When you encounter a bug during development:

1. Write a failing test that reproduces the bug (RED)
2. Follow the TDD cycle — GREEN = the fix
3. The test proves the fix works AND prevents regression
4. Never fix bugs without a failing test first

Bug fixes without tests are patches, not fixes. The test is the proof.

## Integration

**Prerequisites**: Clear specification or requirements for the feature being built.
**Used by**: programmer agent (when TDD mode enabled), tester agent
**Related skills**: verification-patterns (verify after TDD), code-review-guide (review the result)
**Feeds into**: .devt/state/impl-summary.md and .devt/state/test-summary.md
