# Systematic Debugging Protocol

When encountering a bug, test failure, or unexpected behavior during implementation.

## The Rule

NO FIXES WITHOUT INVESTIGATION. Follow all 4 phases before changing any code.

When debugging code you wrote, fight your own mental model: you remember intent, not implementation. Treat your code as foreign.

## Phase 1: Root Cause Investigation

1. Read the FULL error message and stack trace — every line, not just the first
2. Reproduce the issue (run the failing command again)
3. Check recent changes (`git diff` — what did YOU change?)
4. Gather evidence at each boundary:
   - Input → function → output: where does it diverge?
   - Request → service → repository → database: which layer fails?
   - For multi-component systems, check data entering AND exiting EACH component
5. Write down what you observe (facts, not theories)

**Evidence quality**: Only act on strong evidence (directly observable, repeatable, unambiguous). Weak evidence (hearsay, non-repeatable, ambiguous) needs more investigation.

## Phase 2: Pattern Analysis

1. Find a working example of similar code in the codebase
2. Compare line by line: what's different between working and broken?
3. List every difference, however small — do not assume "that can't matter"
4. Check dependencies: did a dependency change?
5. Check configuration: is the environment correct?

## Phase 3: Hypothesis

1. Generate 3+ competing hypotheses before investigating any
2. Select the most promising one
3. State it as a FALSIFIABLE claim: "The bug is caused by X because Y, and if I do Z I will observe W"
4. Design a minimal experiment: change ONE variable
5. Run the experiment, record what actually happened vs predicted

If wrong: return to Phase 1 with new information. Do NOT try another fix.

**Decision gate** — Act only when you can answer YES to ALL:
1. Understand the mechanism? (not just "what" but "why")
2. Reproduce reliably?
3. Have evidence, not just theory?
4. Ruled out alternatives?

## Phase 4: Implementation

1. Create a failing test that reproduces the bug
2. Apply the MINIMAL fix (smallest change that fixes the root cause)
3. Run the test — it must pass now
4. Run ALL tests — no regressions
5. Apply defense-in-depth: add validation at entry point, business logic, and data layers to make the bug structurally impossible (see `programmer/defense-in-depth.md`)

## Escalation

After 3 failed fix attempts on the same issue:

- STOP. The problem is likely architectural, not a simple bug.
- Signs of architectural problem: each fix reveals new coupling, fixes require massive refactoring, each fix creates new symptoms elsewhere.
- Report as BLOCKED with: what you tried, what happened, why you think the architecture is the issue.

**When to restart entirely**:
- 2+ hours with no progress → tunnel vision
- 3+ fixes that didn't work → mental model is wrong
- Can't explain current behavior → don't add changes on top of confusion
- Fix works but you don't know why → not fixed, just lucky

## Red Flags

- "Quick fix" → Phase 1 first. Always.
- "Try this" → That's guessing. Form a falsifiable hypothesis (Phase 3).
- "Change multiple things" → One variable at a time.
- "It works on my end" → Reproduce in the failing environment.
- "One more attempt" (after 2+ failures) → 3+ = architectural. Question the pattern.
- "Here are the problems: [lists fixes without investigation]" → Proposing solutions before tracing data flow.

## Cognitive Bias Awareness

| Bias | Trap | Antidote |
|------|------|----------|
| Confirmation | Only seek supporting evidence | Actively seek disconfirming evidence |
| Anchoring | First explanation becomes your anchor | Generate 3+ hypotheses first |
| Availability | Recent bugs → assume similar | Treat each bug as novel |
| Sunk Cost | Spent hours, keep going | Every 30 min: "Would I still take this path if starting fresh?" |
