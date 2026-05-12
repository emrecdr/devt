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

## Version Bump — Keep Sources In Sync

When a PR introduces a change that justifies a new version, bump **every** version source the project uses in the same commit. Concrete files vary per project, but typically include:

- A dedicated `VERSION` file (devt promotes this pattern — single line, `X.Y.Z`).
- The changelog file (commonly `docs/API-CHANGELOG.md` or `CHANGELOG.md`).
- Any code-level version constant the binary exposes (e.g. via a `--version` flag or `/health` payload) — common in Go since the toolchain doesn't write a version into a manifest.
- A `v<X.Y.Z>` git tag for Go module consumers — tagged AFTER the bump commit lands on the default branch.

All numeric values MUST match. CI pipeline guards typically reject main-bound merges where `VERSION` is not strictly greater than main's via `sort -V`. See [`./api-changelog.md`](./api-changelog.md) for the full rule.

**Common failure**: bumping only the changelog when merging into the integration branch, then having the integration → main PR rejected because `VERSION` is still at the old number.

---

## Quality Checklist

Before creating a PR:

- [ ] Code compiles: `go build ./...`
- [ ] Tests pass: `go test ./... -race -count=1`
- [ ] Lint clean: `golangci-lint run ./...`
- [ ] Vet clean: `go vet ./...`
- [ ] No dead code introduced
- [ ] Commit messages follow convention
- [ ] PR description explains WHY, not just WHAT
- [ ] If version was bumped: every version source the project uses (VERSION, changelog, code-level constant, eventual git tag) shows the same `X.Y.Z`
