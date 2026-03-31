---
name: strategic-analysis
description: Use when comparing multiple implementation approaches before committing to one. Trigger on 'which approach is better', 'should I use X or Y', 'what are the trade-offs', 'pros and cons', or when facing any design decision with multiple viable options.
---

# Strategic Analysis

## Overview

When multiple implementation approaches exist, choosing the wrong one has compounding costs. Strategic analysis forces explicit comparison before commitment, replacing gut decisions with reasoned trade-off evaluation.

The goal is not to find the perfect approach. It is to make the trade-offs visible so the decision-maker (the user) can choose with full information.

**Depth mandate**: If your options are two flavors of the same approach, you haven't analyzed deeply enough.

## The Iron Law

```
NO IMPLEMENTATION WITHOUT AN APPROVED DECISION
```

Implementation creates momentum — once code is written, the team gravitates toward finishing it rather than reconsidering the approach. Comparing options before coding ensures the chosen approach reflects deliberate evaluation rather than whatever came to mind first. This is especially critical for decisions that are hard to reverse, such as data model choices and integration patterns.

Committing to an approach without explicit comparison and user approval compounds wrong choices. Make trade-offs visible before writing code.

## The Process

### Step 1: Identify Options

List at least 2 concrete approaches. For each option, provide:

- **Name**: A short descriptive label
- **Description**: What this approach does in 1-2 sentences
- **Example**: A concrete code sketch or structural outline

If only one option seems viable, you have not looked hard enough. There is always an alternative — even if it is "do nothing" or "defer the decision."

### Step 2: Define Evaluation Criteria

Choose criteria relevant to the specific decision. Common criteria include:

- **Complexity**: How much code, how many files, how many concepts
- **Reversibility**: How hard is it to change later
- **Consistency**: Does it match existing patterns in the codebase
- **Performance**: Runtime characteristics, query count, memory usage
- **Testability**: How easy is it to test in isolation
- **Migration effort**: If replacing existing code, how much changes

Not all criteria apply to every decision. Select 3-5 that matter most.

### Step 3: Evaluate Trade-offs

For each option, score against each criterion. Use a simple scale:

- **+** Advantage
- **-** Disadvantage
- **=** Neutral

Structure as a comparison table:

```
| Criteria      | Option A | Option B | Option C |
|---------------|----------|----------|----------|
| Complexity    | +        | =        | -        |
| Reversibility | -        | +        | +        |
| Consistency   | +        | +        | -        |
```

Below the table, explain each non-obvious score.

### Step 4: Recommend

State your recommendation clearly with reasoning:

```
Recommendation: Option B

Reasoning: While Option A has lower complexity, Option B's
reversibility advantage is more important because the requirements
are likely to change. Option B also follows the existing pattern
in the user service, reducing cognitive load for the team.
```

Always include: what you recommend, why, and what you are trading away.

### Step 5: Present to Decision-Maker

Present the full analysis — options, trade-offs, and recommendation — to the user. Do not implement before getting a decision. The user may have context you lack (upcoming features, team preferences, business constraints).

### Option Quality Examples

**PASS -- Genuinely different approaches:**

- Option A: Event-driven architecture (async, decoupled, eventually consistent)
- Option B: Direct service calls (sync, simple, immediately consistent)
- WHY: Different trade-offs in consistency, complexity, and coupling

**FAIL -- Cosmetic variations:**

- Option A: Use Redis for caching
- Option B: Use Memcached for caching
- WHY: Same architectural pattern, same trade-offs. This is an implementation detail, not a strategic choice.

## When NOT to Use

Skip when there's only one viable approach, or when the user has already decided and just wants implementation. Analysis paralysis is worse than picking any reasonable option.

## Too Many Options

If you identify more than 4 options, narrow to the top 3 before evaluating. More than 4 options usually means some are cosmetic variations that should be merged.

## Self-Test

After recommending, ask: "Would I bet my own project on this recommendation?" If not, your analysis is incomplete.

## Time Budget

- Quick comparison (2 options): 2-3 minutes
- Full analysis (3-4 options): 5-8 minutes

## Gate: Decision Before Implementation

- [ ] Recommendation presented with reasoning
- [ ] User has approved an approach
- [ ] No implementation started before approval

## Anti-patterns

| Don't                                     | Why It Fails                                               | Do Instead                                             |
| ----------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------ |
| "There's only one way to do this"         | There is always an alternative                             | Look harder -- even "defer the decision" is an option  |
| "Let's just go with the obvious approach" | Obvious to whom? Implicit reasoning hides trade-offs       | Make it explicit in a comparison table                 |
| "We can always change it later"           | "Later" has a cost you haven't quantified                  | Estimate the reversal cost for each option             |
| Implement both and let the user choose    | Analysis, not code, is the decision tool                   | Present trade-offs, not prototypes                     |
| "Analysis paralysis -- just pick one"     | 15 minutes of comparison prevents days of rework           | Time-box the analysis, don't skip it                   |
| "I already know which is best"            | Then the analysis will be quick and confirm your intuition | Write it down anyway -- intuition is not documentation |
| Present two flavors of the same approach  | Cosmetic variations waste the decision-maker's time        | Ensure options have genuinely different trade-offs     |

## Integration

- **Prerequisites**: codebase-scan (to understand what exists), complexity-assessment (to know the task tier)
- **Feeds into**: Implementation plan, architecture decisions
- **Used by agents**: architect (primary), workflow orchestrator (for workflow planning)
- **Related skills**: code-review-guide (to evaluate the implemented choice)
