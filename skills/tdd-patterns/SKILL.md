---
name: tdd-patterns
description: Use when implementing features with test-driven development. Enforces RED-GREEN-REFACTOR cycle with mandatory verification gates — test must FAIL before implementation, test must PASS after. Trigger on 'TDD', 'test first', 'write the test before the code', or when implementing critical business logic where specification correctness matters.
---

# TDD Patterns

## Overview

Test-Driven Development writes the test BEFORE the implementation. This catches different bugs than test-after — it verifies the specification is correct, not just that the code runs.

## When to Use

- When the task specifies TDD or test-first approach
- When implementing critical business logic
- When the specification is clear enough to write tests from

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

## Commit Pattern

Each cycle = 2-3 commits:
1. `test: add failing test for [behavior]` (RED)
2. `feat: implement [behavior]` (GREEN)
3. `refactor: clean up [behavior]` (only if refactored)

## Red Flags — STOP

- "I'll write the test after" → That's not TDD. RED comes first.
- "Let me just code this up, then test" → Same thing. RED first.
- "The test already passes" → Either feature exists or test is wrong. Investigate.
- "Delete the old test? But I spent time on it" → Sunk cost. If it's wrong, delete it.

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "This is too simple for TDD" | Simple code benefits most from TDD — fast cycle, clear spec |
| "I know what I'm building" | TDD tests your understanding, not your confidence |
| "Tests slow me down" | TDD prevents debugging later. Net time saved. |
| "I'll keep the code as reference" | You'll adapt it. That's coding-first. Delete and start RED. |
| "Test-after achieves the same" | Test-after answers "does my code work?" TDD answers "does my spec work?" Different questions. |

## Integration

**Prerequisites**: Clear specification or requirements for the feature being built.
**Used by**: programmer agent (when TDD mode enabled), tester agent
**Related skills**: verification-patterns (verify after TDD), code-review-guide (review the result)
**Feeds into**: .devt-state/impl-summary.md and .devt-state/test-summary.md
