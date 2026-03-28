# Quality Gates — Vue 3 + Bootstrap 5

All gates must pass before completing any task.

## Gate 1: Lint

```bash
npx eslint . --ext .vue,.js,.jsx,.cjs,.mjs --fix --ignore-path .gitignore
```

Exit code 0 = pass. Fix all errors before proceeding. Warnings are acceptable only if documented.

## Gate 2: Format

```bash
npx prettier --check src/
```

Exit code 0 = pass. Run `npm run format` to auto-fix formatting issues.

## Gate 3: Build

```bash
npm run build
```

Exit code 0 = pass. The production build must succeed with no errors. Warnings about chunk size are acceptable (limit: 1600KB).

## Gate 4: E2E Tests (when test infrastructure available)

```bash
npx playwright test
```

Exit code 0 = pass. All Playwright E2E tests must pass. If tests are failing due to backend unavailability, document it and skip this gate with justification.

## Running All Gates

```bash
npm run lint && npx prettier --check src/ && npm run build
```

## When to Run

- **Before completing any implementation task**: Gates 1-3 mandatory
- **Before shipping/PR**: All 4 gates mandatory
- **After modifying test infrastructure**: Gate 4 mandatory
