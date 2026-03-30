# Interpretation Rules

How to classify scanner findings as true positive, acceptable design, or false positive. The cardinal rule: always read the actual code before classifying.

## True Positive

A finding is a true positive when the code genuinely violates an architectural principle, documented standard, or best practice.

**Criteria**:

- The issue exists in the code as the scanner describes
- The issue has a concrete negative consequence (security, maintainability, correctness)
- No documented decision or rationale justifies the current state

**Action**: Fix it. Assign a priority based on severity and impact.

## Acceptable Design

A finding is acceptable design when the code intentionally deviates from the ideal pattern for a documented reason.

**Criteria**:

- The code does what the scanner flags
- A documented rationale exists (ADR, code comment, design doc) explaining why
- The trade-off is reasonable given the constraints
- The deviation is bounded (does not spread to other parts of the codebase)

**Action**: Document it in the report as a known trade-off. If no documentation exists, add it. An undocumented trade-off is indistinguishable from a bug.

**Warning**: "Acceptable design" is the most abused classification. Before using it, verify:

1. The rationale is written down somewhere (not just "everyone knows")
2. The rationale is still valid (constraints may have changed)
3. You are not rationalizing to avoid fixing

## False Positive

A finding is a false positive when the scanner is wrong about the code.

**Criteria**:

- The scanner misidentified the pattern (e.g., flagged a type-checking import as a runtime import)
- The code is correct and the scanner's heuristic does not account for this case
- Reading the code confirms there is no actual issue

**Action**: Dismiss with a one-line explanation of why the scanner is wrong. Consider whether the scanner's heuristic can be improved.

## Classification Rules

1. **Read the code first** — Never classify from the scanner description alone. The description is a heuristic; the code is the truth.

2. **Default to true positive** — If you are unsure, treat it as a real issue. It is safer to investigate a false positive than to dismiss a true positive.

3. **Require evidence for dismissal** — Dismissing a finding (acceptable or false positive) requires a specific explanation. "It's fine" is not an explanation.

4. **Check for documentation** — If a finding is "acceptable design" but has no documentation, the first action is to add documentation, not to dismiss the finding.

5. **Cluster before classifying** — Related findings should be classified together. If one instance is a true positive, all instances of the same pattern are also true positives.

6. **Re-evaluate over time** — An "acceptable design" classification from 6 months ago may no longer be acceptable if constraints have changed. Scanner results should prompt re-evaluation.

## Anti-Patterns in Classification

| Anti-Pattern                                  | Why It Is Wrong                                                                     |
| --------------------------------------------- | ----------------------------------------------------------------------------------- |
| Classifying everything as "acceptable"        | You are rationalizing, not classifying                                              |
| Dismissing findings in unfamiliar code        | If you do not understand the code, you cannot classify the finding                  |
| "Pre-existing issue" as a classification      | Not a valid classification. True positive, acceptable, or false positive — pick one |
| Classifying without reading the code          | The scanner output is a hint, not a verdict                                         |
| Using "false positive" to mean "low priority" | False positive means the scanner is wrong. Low priority is still a true positive.   |
