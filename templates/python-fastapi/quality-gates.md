# Quality Gates — Python / FastAPI

## Gate 1: Linting

```bash
uv run ruff check --fix .
```

Enforces consistent style, catches common errors, auto-fixes where possible.

## Gate 2: Type Checking

```bash
uv run mypy .
```

Type errors are blocking. All code must pass strict type checking.

## Gate 3: Unit Tests

```bash
uv run pytest tests/unit/ -x
```

Runs unit tests, stops on first failure. All tests must pass.

## Pass Criteria

- All gates must exit with code 0
- Any non-zero exit code = gate failure
- Run all gates before pushing code
- CI pipeline enforces these same gates on every PR

## Quick Reference

Run all gates sequentially:

```bash
uv run ruff check --fix . && uv run mypy . && uv run pytest tests/unit/ -x
```

## Optional: Full Validation

For thorough pre-push validation including integration and E2E tests:

```bash
uv run pytest tests/ -x
```
