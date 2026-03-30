# Review Checklists

Comprehensive checklists for code review. Each category lists what to check, the severity level, and examples. Read `.devt/rules/coding-standards.md` and `.devt/rules/architecture.md` for project-specific rules.

## 0. Plan / Spec Alignment (FIRST — before code quality)

| Check                                                  | Severity  | Example Violation                                                |
| ------------------------------------------------------ | --------- | ---------------------------------------------------------------- |
| All planned features implemented                       | Critical  | Spec called for caching layer, implementation skipped it         |
| No unplanned features added (scope creep)              | Important | Added pagination when spec only required list endpoint           |
| Decisions from `/devt:clarify` followed                | Critical  | Decision D-01 chose REST over GraphQL, implementation uses gRPC  |
| Requirements interpretation matches original intent    | Important | Spec said "validate email", impl only checks for @ symbol       |
| impl-summary claims verified against actual code       | Critical  | Summary says "added auth middleware" but no middleware exists    |

**This category comes FIRST.** Beautiful code that solves the wrong problem scores 0. If spec is not met, verdict is NEEDS_WORK regardless of code quality score.

## 1. Architecture Compliance

| Check                                      | Severity  | Example Violation                                           |
| ------------------------------------------ | --------- | ----------------------------------------------------------- |
| Layer boundaries respected                 | Critical  | Service layer importing infrastructure details              |
| Dependency direction correct (inward only) | Critical  | Domain layer depending on application layer                 |
| No circular dependencies                   | Critical  | Module A imports Module B which imports Module A            |
| Correct module placement                   | Important | Business logic in route handlers instead of services        |
| Interface/contract usage at boundaries     | Important | Concrete implementations used instead of abstractions       |
| No cross-boundary data leakage             | Important | Database models exposed in API responses                    |
| Single responsibility per file/class       | Minor     | One file handling validation, persistence, and notification |

## 2. Security

| Check                                           | Severity  | Example Violation                             |
| ----------------------------------------------- | --------- | --------------------------------------------- |
| Input validation on all external data           | Critical  | User input passed directly to queries         |
| Authentication required on protected endpoints  | Critical  | Endpoint missing auth dependency              |
| Authorization checks for scoped operations      | Critical  | User A accessing User B's data                |
| No secrets in code or logs                      | Critical  | API key hardcoded in source                   |
| No sensitive data in error responses            | Important | Stack traces or internal IDs in 4xx responses |
| Rate limiting on public endpoints               | Important | Login endpoint with no throttling             |
| Parameterized queries (no string interpolation) | Critical  | String-interpolated queries                   |

## 3. Performance

| Check                                       | Severity  | Example Violation                           |
| ------------------------------------------- | --------- | ------------------------------------------- |
| No N+1 query patterns                       | Important | Loop that issues one query per item         |
| No unnecessary database round-trips         | Important | Two queries where one JOIN suffices         |
| No unbounded result sets                    | Important | Query with no LIMIT on user-facing endpoint |
| No blocking operations in async paths       | Important | Synchronous I/O in async handler            |
| Appropriate use of indexes (for new tables) | Minor     | Frequent filter column without index        |
| No redundant data fetching                  | Minor     | Loading full entity when only ID is needed  |

## 4. Error Handling

| Check                                       | Severity  | Example Violation                                           |
| ------------------------------------------- | --------- | ----------------------------------------------------------- |
| No swallowed exceptions                     | Critical  | Bare `except: pass` or catch-all that hides typed errors    |
| Correct error types used                    | Important | Returning 500 for validation errors                         |
| Error messages are helpful but not leaky    | Important | Exposing internal paths or query details in error messages  |
| All error paths tested                      | Important | Only happy path has test coverage                           |
| Graceful degradation where appropriate      | Minor     | Entire request fails because a non-critical feature errored |
| Error hierarchy follows project conventions | Minor     | Custom exception not extending base error class             |

## 5. Test Coverage

See `code-reviewer/test-coverage-checklist.md` for detailed test review criteria.

| Check                           | Severity  | Example Violation                                           |
| ------------------------------- | --------- | ----------------------------------------------------------- |
| Every public function has tests | Important | New service method with zero test coverage                  |
| Error paths are tested          | Important | Only success scenarios in tests                             |
| Edge cases covered              | Minor     | No test for empty input, max values, or boundary conditions |
| No test interdependencies       | Minor     | Test B fails when Test A is skipped                         |
| Mocking at correct boundaries   | Important | Mocking internal methods instead of external dependencies   |

## 6. Code Quality

| Check                                               | Severity  | Example Violation                                 |
| --------------------------------------------------- | --------- | ------------------------------------------------- |
| No code duplication                                 | Important | Same logic copy-pasted across files               |
| Clear, descriptive naming                           | Minor     | Single-letter variables, ambiguous function names |
| Type annotations present and correct                | Minor     | Missing type hints on public functions            |
| No dead code (unused imports, unreachable branches) | Minor     | Commented-out blocks, unused variables            |
| Functions are focused (single responsibility)       | Minor     | 100-line function doing 5 things                  |
| Nesting depth within limits                         | Minor     | 4+ levels of nested if/for/try                    |
| No magic numbers or strings                         | Minor     | Hardcoded constants without named references      |
| Imports at module level (no inline imports)         | Minor     | Import inside function body                       |

## 7. Production Readiness

| Check | Severity | Example Violation |
|-------|----------|-------------------|
| Migration exists for schema changes | Critical | New column added but no migration file |
| Env vars documented in .env.example | Important | New env var required but not documented |
| Module documentation updated | Important | New endpoint but MODULE.md not updated |
| Breaking API changes documented | Critical | Response format changed without changelog |
| No debug artifacts in code | Minor | print() statements, hardcoded localhost URLs |
| No TODO/FIXME in new code | Important | Placeholder code marked for future completion |

## Applying Checklists

1. Go through EVERY item in EVERY category for EVERY changed file
2. Record each violation as a finding with the listed severity
3. If unsure whether something violates a rule, check `.devt/rules/` — if the rule exists, it is a finding
4. Do NOT skip items because the code "looks clean overall"
5. Do NOT downgrade severity because the violation is common in the codebase
