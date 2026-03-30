# Fix-Loop Protocol

When a quality gate fails, follow this protocol to resolve the issue efficiently and avoid infinite loops.

## Rules

1. **Maximum 5 iterations per issue type.** If the same category of failure persists after 5 attempts, escalate.
2. **Never repeat the same fix.** If you tried something and it did not work, that approach is eliminated. Move to a different strategy.
3. **Always diagnose before fixing.** Read the error message completely. Understand the root cause before changing code.
4. **Track every attempt.** Maintain a log of what you tried and what happened.
5. **Never add complexity to work around a failure.** Fix the actual problem.

## Iteration Thresholds

### Iteration 1-2: Direct Fix

- Read the error carefully and completely
- Identify the root cause — not the symptom
- Apply the most targeted correction
- Re-run the quality gate

### Iteration 3: Simplify

- The direct approach is not working. Step back.
- Simplify the implementation — reduce moving parts
- Consider whether the approach itself is wrong, not just the details
- Re-read the relevant `.devt/rules/` file for patterns you may have missed
- Re-read working examples in the codebase for the same pattern

### Iteration 4: Alternative Approach

- The current strategy has failed. Try a fundamentally different approach.
- Look at how similar problems are solved elsewhere in the codebase
- Consider whether the test or gate expectation is correct (but do NOT skip the gate)

After applying the fix, consider defense-in-depth: see `defense-in-depth.md` for multi-layer validation.

### Iteration 5: Escalate

- Surface the issue to the user as BLOCKED
- Document in `.devt/state/impl-summary.md`:
  - Status: BLOCKED
  - What was tried (all 4 prior attempts, with exact errors)
  - What failed and why
  - What you believe the root cause is
  - What you recommend as next steps

## What to Track

For each iteration, note:

- **Attempt number**: N of 5
- **What was tried**: Specific change made
- **Result**: What happened (exact error or behavior)
- **Learning**: What this tells you about the root cause

## Never Do

- **Never repeat the same fix** expecting different results
- **Never ignore the root cause** and add workarounds
- **Never add complexity to work around a failure** — fix the actual problem
- **Never skip a quality gate** because fixing is hard
- **Never silently give up** — always escalate with full context if you cannot resolve it
- **Never blame the tooling** — the gate caught a real issue, find it
