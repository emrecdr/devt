# Test Registration

Standards for registering and cataloging tests so they are discoverable, traceable, and meaningful. Read `.dev-rules/testing-patterns.md` for project-specific conventions.

## Every Test Must Have

### 1. Name
A descriptive name that communicates:
- **What** is being tested (the function, method, or behavior)
- **Under what conditions** (the specific scenario or input)
- **What is expected** (the outcome)

Good: `test_register_user_with_duplicate_email_returns_conflict_error`
Bad: `test_register_user_2`
Bad: `test_error_case`

### 2. Description
If the test name alone does not fully explain the scenario, add a docstring:
- What business rule or requirement this test validates
- Why this scenario matters (what could go wrong without it)

### 3. Coverage Mapping
Every test should trace back to a requirement or behavior:
- Business rule: "Users cannot register with an email already in use"
- Error handling: "Service returns a typed error when the database is unreachable"
- Edge case: "Empty string input is rejected, not treated as valid"

## Test Metadata

Follow the project-specific metadata format defined in `.dev-rules/testing-patterns.md`. Common patterns include:
- Test markers or tags for categorization (unit, integration, e2e)
- Module or feature association
- Criticality level (smoke test, regression, edge case)

## Mapping: Business Scenarios to Test Cases

For each feature or change, create a mapping:

```
Feature: User Registration
  Scenario: Successful registration
    -> test_register_user_with_valid_data_creates_account
    -> test_register_user_returns_user_id_and_email
  Scenario: Duplicate email
    -> test_register_user_with_duplicate_email_returns_conflict
  Scenario: Invalid input
    -> test_register_user_with_missing_email_returns_validation_error
    -> test_register_user_with_invalid_email_format_returns_validation_error
  Scenario: Permission check
    -> test_register_user_without_admin_role_returns_forbidden
```

## Principles

- **No orphan tests**: Every test must map to a real behavior or requirement
- **No test duplication**: Two tests should not verify the exact same thing
- **Descriptive over clever**: A long, clear test name beats a short, cryptic one
- **Tests document behavior**: A new developer should understand the system's rules by reading test names
