# Quality Gates

Define your quality gate commands below. Each gate is a bash code block that must exit 0 to pass.
Replace the placeholder commands with your project's actual commands.

## Gate 1: Linting

```bash
# Replace with your linting command:
# uv run ruff check .
# npx eslint .
# golangci-lint run ./...
echo "WARN: Linting gate not configured. Edit .devt/rules/quality-gates.md"
```

## Gate 2: Type Checking

```bash
# Replace with your type checking command:
# uv run mypy app/
# npx tsc --noEmit
# go vet ./...
echo "WARN: Type checking gate not configured. Edit .devt/rules/quality-gates.md"
```

## Gate 3: Tests

```bash
# Replace with your test command:
# uv run pytest tests/unit/
# npx jest --coverage
# go test ./...
echo "WARN: Test gate not configured. Edit .devt/rules/quality-gates.md"
```

## Pass Criteria

- All gates must exit with code 0
- Any non-zero exit code = gate failure
- Run all gates before pushing code
- Placeholder gates above pass with warnings — replace them with real commands
