# Systematic Debugging Protocol

When encountering a bug, test failure, or unexpected behavior during implementation.

## The Rule

NO FIXES WITHOUT INVESTIGATION. Follow all 4 phases before changing any code.

## Phase 1: Root Cause Investigation

1. Read the FULL error message and stack trace
2. Reproduce the issue (run the failing command again)
3. Check recent changes (`git diff` — what did YOU change?)
4. Gather evidence at each boundary:
   - Input → function → output: where does it diverge?
   - Request → service → repository → database: which layer fails?
5. Write down what you observe (facts, not theories)

## Phase 2: Pattern Analysis

1. Find a working example of similar code in the codebase
2. Compare: what's different between working and broken?
3. Check dependencies: did a dependency change?
4. Check configuration: is the environment correct?

## Phase 3: Hypothesis

1. Form ONE hypothesis (not multiple)
2. State it clearly: "The bug is caused by X because Y"
3. Design a minimal test: change ONE variable to confirm/deny
4. Run the test

If hypothesis is wrong: go back to Phase 1 with new information. Do NOT try another fix.

## Phase 4: Implementation

1. Create a failing test that reproduces the bug
2. Apply the MINIMAL fix (smallest change that fixes the root cause)
3. Run the test — it must pass now
4. Run ALL tests — no regressions

## Escalation

After 3 failed fix attempts on the same issue:
- STOP. The problem is likely architectural, not a simple bug.
- Report as BLOCKED with: what you tried, what happened, why you think the architecture is the issue.
- Let the user decide whether to redesign or work around.

## Red Flags

- "Quick fix" → You haven't investigated. Go to Phase 1.
- "Try this" → That's guessing. Form a hypothesis first (Phase 3).
- "Change multiple things" → One variable at a time.
- "It works on my end" → Reproduce in the failing environment.
