# Testing Patterns — TypeScript / Node

## Frameworks

- **Unit tests**: Jest or Vitest (Vitest preferred for ESM projects)
- **E2E tests**: Playwright (browser), Supertest (API)
- **API mocking**: MSW (Mock Service Worker) for intercepting HTTP at network level
- **Assertions**: Built-in matchers from test framework

## File Naming & Organization

- Test files: `*.test.ts` or `*.spec.ts` — pick one convention, use it everywhere
- Colocate tests with source: `user-service.ts` + `user-service.test.ts`
- Or use `__tests__/` directory adjacent to source files
- Shared test utilities in `test/helpers/` or `test/fixtures/`

## Test Structure

- `describe` / `it` blocks with clear descriptions
- Arrange / Act / Assert pattern
- One concept per test — multiple assertions on same result are fine
- Use `beforeEach` for common setup, avoid `beforeAll` unless truly shared

## Coverage Targets

- Minimum 80% line coverage
- 100% on critical business logic (payments, auth, data mutations)
- Coverage is a floor, not a ceiling — don't game the metric

## Mocking Rules

- MSW for external API mocking — intercepts at network level, no coupling to implementation
- Mock at module boundaries only — never mock the thing under test
- Prefer dependency injection over `jest.mock()` — easier to understand and maintain
- Reset mocks between tests to prevent state leakage

## Unit Test Patterns

- Test pure functions with input/output assertions
- Test services with injected mock dependencies
- Test error paths: invalid input, missing data, permission denied
- Test edge cases: empty arrays, null/undefined, boundary values

## Integration Test Patterns

- Hit real database (test containers or Docker Compose)
- Each test manages its own data — no shared mutable state
- Test the full request/response cycle for API endpoints
- Verify database state after mutations

## E2E Test Patterns

- Test complete user workflows
- Use realistic test data
- Run against a deployed (or locally running) instance
- Isolate from other tests — each E2E test is independent

## What NOT to Test

- TypeScript type system (compiler handles this)
- Third-party library internals
- Framework boilerplate (routing config, middleware wiring)
- Trivial mappers with no logic
