# Git Workflow

## Branch Creation Rules

### Always Branch from the Default Branch

```bash
# CORRECT
git checkout main
git pull
git checkout -b feature/<feature-name>

# WRONG — creates branch from another feature branch
git checkout -b feature/new-thing  # while on feature/other — pollutes PR
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
feat(auth): add token refresh middleware

fix(user): handle duplicate email on registration

test(auth): add tests for token validation

refactor(repo): extract common query builder
```

## Pull Request Format

```bash
gh pr create --title "feat(scope): short description" --body "$(cat <<'EOF'
## Summary
- What was done and why

## Changes
- List key files/modules modified

## Test plan
- [ ] All tests pass
- [ ] Linter/type-checker clean
- [ ] Manual verification of [specific behavior]

## Notes
- Any context reviewers need
EOF
)"
```

## Common Mistakes and Fixes

| Mistake | Fix |
|---------|-----|
| Branch from feature branch | Always `git checkout main && git pull` first |
| Giant PR (50+ files) | Split by module/concern into smaller PRs |
| Commit message says "fix stuff" | Use conventional format: `fix(scope): what` |
| PR includes unrelated formatting | Run formatter separately from feature commits |
| No PR description | Always explain WHY, not just WHAT |

## Quality Checklist

Before creating a PR:

- [ ] Code compiles / builds without errors
- [ ] All tests pass
- [ ] Linter / type-checker clean
- [ ] No dead code introduced
- [ ] Commit messages follow convention
- [ ] PR description explains WHY, not just WHAT
