# Git Workflow — Go

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

Examples:
- `feature/user-auth`
- `fix/token-expiry-handling`
- `refactor/split-user-service`

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
feat(auth): add JWT token refresh middleware

fix(user): handle duplicate email on registration

test(auth): add table-driven tests for token validation

refactor(repo): extract common query builder
```

## Pull Request Format

```bash
gh pr create --title "feat(scope): short description" --body "$(cat <<'EOF'
## Summary
- What was done and why

## Changes
- List key files/packages modified

## Test plan
- [ ] `go test ./... -race` passes
- [ ] `golangci-lint run` clean
- [ ] Manual verification of [specific behavior]

## Notes
- Any context reviewers need
EOF
)"
```

## Common Mistakes and Fixes

| Mistake | Fix |
|---------|-----|
| Committing generated code (`*.pb.go`) | Add to `.gitignore` or commit separately |
| Committing vendor/ when using modules | Remove vendor/, use `go mod download` |
| PR includes unrelated formatting | Run `gofmt` separately from feature commits |
| Branch from feature branch | Always `git checkout main && git pull` first |
| Giant PR (50+ files) | Split by package/concern into smaller PRs |
| Commit message says "fix stuff" | Use conventional format: `fix(scope): what` |

## Quality Checklist

Before creating a PR:

- [ ] Code compiles: `go build ./...`
- [ ] Tests pass: `go test ./... -race -count=1`
- [ ] Lint clean: `golangci-lint run ./...`
- [ ] Vet clean: `go vet ./...`
- [ ] No dead code introduced
- [ ] Commit messages follow convention
- [ ] PR description explains WHY, not just WHAT
