# Quality Gates — TypeScript / Node

## Gate 1: Linting

```bash
npx eslint .
```

Enforces consistent style and catches common errors.

## Gate 2: Type Checking

```bash
npx tsc --noEmit
```

Validates all types without producing output. Type errors are blocking.

## Gate 3: Unit Tests

```bash
npx jest --ci
```

Runs all unit tests in CI mode (no interactive prompts, fails on no tests).

For Vitest projects, replace with:

```bash
npx vitest run
```

## Pass Criteria

- All gates must exit with code 0
- Any non-zero exit code = gate failure
- Run all gates before pushing code

## Quick Reference

Run all gates sequentially:

```bash
npx eslint . && npx tsc --noEmit && npx jest --ci
```

## Optional: Full Validation

```bash
npx playwright test
```
