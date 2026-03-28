# Git Workflow — TypeScript / Node

## Branch Creation Rules

### Always Branch from the Default Branch

```bash
# CORRECT
git checkout main
git pull
git checkout -b feature/<feature-name>

# WRONG — creates branch from another feature branch
git checkout -b feature/add-auth  # while on feature/add-users — pollutes PR
```

### Branch Naming

- `feature/<feature-name>` — New features
- `fix/<issue-description>` — Bug fixes
- `refactor/<scope>` — Code improvements
- `hotfix/<critical-fix>` — Production-critical fixes

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
| `test` | Adding or updating tests |
| `docs` | Documentation only |
| `refactor` | Code change that doesn't fix or add |
| `style` | Formatting, linting (no logic change) |
| `chore` | Build, deps, tooling |

### Examples

```bash
feat(auth): add JWT refresh token middleware

fix(user): handle duplicate email on registration

test(auth): add integration tests for token validation

refactor(api): extract common error handler middleware
```

## Pull Request Format

```bash
gh pr create --title "feat(scope): short description" --body "$(cat <<'EOF'
## Summary
- What was done and why

## Changes
- List key modules modified

## Test plan
- [ ] `npx eslint .` passes
- [ ] `npx tsc --noEmit` passes
- [ ] `npx vitest run` passes (or `npx jest --ci`)
- [ ] Manual verification of [specific behavior]

## Notes
- Any context reviewers need
EOF
)"
```

## Quality Checklist

Before creating a PR:

- [ ] Lint clean: `npx eslint .`
- [ ] Types clean: `npx tsc --noEmit`
- [ ] Tests pass: `npx vitest run` (or `npx jest --ci`)
- [ ] No dead code introduced
- [ ] No `any` types introduced
- [ ] Commit messages follow convention
- [ ] PR description explains WHY
