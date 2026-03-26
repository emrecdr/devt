# Testing Patterns — Python / FastAPI

## Test Pyramid

1. **E2E tests** (HURL or similar) — primary validation of API contracts
2. **Integration tests** — hit real database, verify repository + service interaction
3. **Unit tests** — isolated business logic, fast feedback

## Frameworks & Tools

- `pytest` for all test types
- HURL for E2E HTTP workflow tests (or equivalent HTTP testing tool)
- Real PostgreSQL for integration tests — never mock the database
- `unittest.mock` for unit tests — minimal mocking only

## Speed Targets

| Type        | Target    | Scope                          |
|-------------|-----------|--------------------------------|
| Unit        | < 1 min   | Service logic, domain rules    |
| Integration | < 3 min   | Repository + real DB           |
| E2E         | < 5 min   | Full HTTP request/response     |

## Mocking Rules

- Maximum 3 mocks per unit test — more indicates poor design
- Mock at boundaries only (repository interfaces, external APIs)
- Never mock the thing under test
- Integration tests use real database — no mocking data access
- Services mock repositories; repositories test against real DB

## File Naming & Organization

- Test files: `test_<module>.py` or `test_<feature>.py`
- Test directories mirror source structure
- Each service has its own `tests/` directory with `unit/` and `integration/` subdirs
- Shared fixtures in `conftest.py` at appropriate scope level

## Test Structure

- Arrange / Act / Assert pattern — clearly separated sections
- One assertion concept per test (multiple asserts on same object are fine)
- Descriptive test names that explain the scenario and expected behavior
- No temporal markers in test names — describe WHAT, not WHEN

## Coverage Requirements

- Every public function must have tests
- Edge cases: empty inputs, boundary values, error conditions
- Error paths: verify correct exception types and messages
- No placeholder tests — every test must assert meaningful behavior

## Integration Test Patterns

- Use test database with migrations applied
- Each test gets a clean transaction (rollback after test)
- Test data created via factories or fixtures — never rely on seed data
- Verify actual database state, not just return values

## E2E Test Patterns

- Test complete user workflows, not individual endpoints
- Verify response status codes, headers, and body structure
- Chain requests: create -> read -> update -> delete
- Test authentication and authorization scenarios
- Validate error responses match API contract

## What NOT to Test

- Framework internals (FastAPI routing, Pydantic validation)
- Third-party library behavior
- Trivial getters/setters with no logic
- Private methods directly — test through public interface
