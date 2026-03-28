# Git Workflow — Vue 3 + Bootstrap 5

## Branch Creation Rules

### Always Branch from the Default Branch

```bash
# CORRECT
git checkout main
git pull
git checkout -b feature/<feature-name>

# WRONG — creates branch from another feature branch
git checkout -b feature/add-settings  # while on feature/add-users — pollutes PR
```

### Branch Naming

- `feature/<feature-name>` — New features
- `fix/<issue-description>` — Bug fixes
- `refactor/<scope>` — Code improvements
- `hotfix/<critical-fix>` — Production-critical fixes
- `test/<test-scope>` — Adding/improving E2E tests

Examples:
- `feature/user-management`
- `fix/login-redirect-loop`
- `refactor/extract-data-table-base`
- `test/roles-crud-e2e`

## Commit Convention

### Format

```
type(scope): short description

Optional body explaining WHY, not WHAT.

Co-Authored-By: Name <email>
```

### Types

| Type | When |
|------|------|
| `feat` | New feature or capability |
| `fix` | Bug fix |
| `test` | Adding or updating tests (unit or E2E) |
| `docs` | Documentation only |
| `refactor` | Code change that doesn't fix or add |
| `style` | Formatting, linting (no logic change) |
| `chore` | Build, deps, tooling |

### Scope

Use the feature module name as scope:

```bash
feat(auth): add two-factor authentication flow
fix(admin/users): handle duplicate email on registration
test(auth): add E2E tests for forgot-password flow
refactor(shared/composables): extract useFormValidation from inline logic
chore(deps): update vue to 3.5.30
```

## Pull Request Format

```bash
gh pr create --title "feat(scope): short description" --body "$(cat <<'EOF'
## Summary
- What was done and why
- Which feature module was affected

## Changes
- List key components/composables/stores modified
- New routes added (if any)
- New API endpoints used (if any)

## Test plan
- [ ] `npm run lint` passes
- [ ] `npx prettier --check src/` passes
- [ ] `npm run build` passes
- [ ] Playwright tests pass: `npx playwright test`
- [ ] Manual verification in browser

## Screenshots
[If UI changes, include before/after screenshots]
EOF
)"
```

## Common Mistakes and Fixes

| Mistake | Fix |
|---------|-----|
| Committing `node_modules/` | Already in `.gitignore` — if missing, add it |
| Committing `.env` files with secrets | Add `.env*.local` to `.gitignore` |
| PR includes unrelated Prettier changes | Run `npm run format` separately from feature commits |
| Branch from feature branch | Always `git checkout main && git pull` first |
| Giant PR (30+ files) | Split by feature module into smaller PRs |
| Commit message says "fix stuff" | Use conventional format: `fix(scope): what` |
| Committing compiled CSS | Only commit SCSS sources, not generated CSS |
| Missing E2E test for new feature | Add at least happy-path E2E before merging |

## Pre-Commit Checklist

Before creating a PR:

- [ ] Code lints: `npm run lint`
- [ ] Code formatted: `npm run format`
- [ ] Build succeeds: `npm run build`
- [ ] No `any` types or `@ts-ignore` (if using TypeScript)
- [ ] No `console.log` left in production code (use `useLogger` instead)
- [ ] No hardcoded API URLs (use `API_ENDPOINTS`)
- [ ] No hardcoded localStorage keys (use `STORAGE_KEYS`)
- [ ] New routes have `meta: { requiresAuth: true }` if protected
- [ ] New API endpoints added to `shared/constants/api.js`
- [ ] Commit messages follow convention
- [ ] PR description explains WHY
