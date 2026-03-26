# Scoring Guide

Objective scoring system for code reviews. The score determines the verdict.

## Starting Score

Every review starts at **100 points**.

## Deductions

| Severity | Points | Description |
|----------|--------|-------------|
| Critical | -15 | Violations that could cause security breaches, data loss, system failures, or fundamental architecture breaks |
| Important | -7 | Violations that degrade maintainability, introduce bugs, or break conventions in meaningful ways |
| Minor | -3 | Style violations, naming issues, or small deviations from best practices |

## Deduction Categories

### Architecture (-15 / -7 / -3)
- Critical: Layer boundary violation, circular dependency, wrong module placement for business logic
- Important: Missing abstraction at boundary, tight coupling between modules
- Minor: Suboptimal file organization, slightly unclear responsibility split

### Security (-15 / -7 / -3)
- Critical: Missing auth, injection vector, secrets in code, unvalidated input in sensitive operations
- Important: Missing rate limiting, overly verbose error responses, insufficient authorization scope
- Minor: Missing input length constraints on non-sensitive fields

### Performance (-15 / -7 / -3)
- Critical: Unbounded query in user-facing hot path, blocking call in async context
- Important: N+1 query pattern, redundant database round-trips, missing pagination
- Minor: Unnecessary data fetching, suboptimal but functional query

### Error Handling (-15 / -7 / -3)
- Critical: Swallowed exceptions hiding failures, generic catch-all masking typed errors
- Important: Wrong error type/status code, missing error handling on external calls
- Minor: Error message could be more descriptive, inconsistent error format

### Test Coverage (-15 / -7 / -3)
- Critical: No tests for new public functionality
- Important: Missing error path tests, over-mocking hiding real bugs
- Minor: Missing edge case coverage, test names could be more descriptive

### Code Quality (-15 / -7 / -3)
- Critical: Duplicated business logic across modules (divergence risk)
- Important: Significant code duplication, missing type annotations on public API
- Minor: Naming issues, magic numbers, excessive nesting, dead code

## Verdict Thresholds

| Score Range | Verdict | Meaning |
|-------------|---------|---------|
| 90 - 100 | APPROVED | Code meets standards. Ship it. |
| 80 - 89 | APPROVED_WITH_NOTES | Code is acceptable but has issues worth addressing. |
| 0 - 79 | NEEDS_WORK | Code has significant issues that must be fixed before proceeding. |

## Scoring Integrity Rules

1. **Never inflate scores.** If a finding exists, the deduction applies. No discounts for project size or deadline pressure.
2. **Never double-deduct.** One finding = one deduction, even if it appears in multiple categories.
3. **Never skip deductions for pre-existing issues.** If the code is in review scope and has a problem, deduct.
4. **Always show the math.** The score breakdown must be auditable — every deduction traced to a finding.
5. **Round fairly.** When a finding is between severities, use the higher severity if the impact justifies it.
