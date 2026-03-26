# Test Coverage Checklist

Detailed checklist for evaluating test quality and coverage during code review.

## 1. Function Coverage

- [ ] Does every new or modified public function have at least one test?
- [ ] Does every new or modified public method on a class have at least one test?
- [ ] Are constructor/initialization paths tested when they contain logic?
- [ ] Are utility/helper functions tested independently?

## 2. Scenario Coverage

- [ ] **Happy path**: Is the primary success scenario tested with realistic data?
- [ ] **Validation failures**: Is every input validation rule tested with invalid data?
- [ ] **Not-found cases**: Are lookups tested when the target does not exist?
- [ ] **Conflict cases**: Are uniqueness constraints tested with duplicate data?
- [ ] **Permission failures**: Are authorization checks tested with insufficient permissions?
- [ ] **Empty inputs**: Are empty strings, empty lists, and null values tested?
- [ ] **Boundary values**: Are min/max values, zero, and limit boundaries tested?

## 3. Error Path Coverage

- [ ] Is every exception type that can be raised actually triggered in a test?
- [ ] Are external dependency failures tested (database down, API timeout)?
- [ ] Are partial failure scenarios tested (some items succeed, some fail)?
- [ ] Do error tests verify the correct error type AND message/details?

## 4. Integration Boundaries

- [ ] Are cross-component interactions tested (service calls repository correctly)?
- [ ] Are data transformations tested at layer boundaries (DTO to entity, entity to response)?
- [ ] Are event/message publishing tests verifying the correct payload?
- [ ] Are database constraint violations tested (unique, foreign key, not-null)?

## 5. Test Quality

- [ ] Does each test have a single clear focus (one behavior per test)?
- [ ] Are test names descriptive enough to understand the scenario without reading the body?
- [ ] Is the Arrange-Act-Assert pattern followed?
- [ ] Are tests independent (no shared mutable state, no execution order dependency)?
- [ ] Are assertions meaningful (checking behavior, not implementation)?
- [ ] Is mocking appropriate (mock at boundaries, not internals)?

## 6. Anti-Patterns to Flag

- **Assert-free tests**: Test runs code but never asserts anything meaningful
- **Tautological tests**: Test asserts what it set up (mock returns X, assert result is X)
- **Over-mocking**: So many mocks that the test verifies mock wiring, not behavior
- **Test duplication**: Multiple tests verifying the exact same scenario differently
- **Brittle tests**: Tests that break when implementation details change but behavior stays the same
- **Missing negative tests**: Only testing that things work, never testing that they fail correctly

## Scoring Impact

| Gap | Severity | Rationale |
|-----|----------|-----------|
| No tests for new public function | Critical (-15) | Untested code is unverified code |
| Missing error path tests | Important (-7) | Error paths are where bugs hide |
| Over-mocking hiding real behavior | Important (-7) | Tests pass but code may not work |
| Missing edge case coverage | Minor (-3) | Boundary bugs are common |
| Poorly named tests | Minor (-3) | Tests are documentation |
