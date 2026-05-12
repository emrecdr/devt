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

## Version Bump — Keep Sources In Sync

When a PR introduces a change that justifies a new version, bump **every** version source the project uses in the same commit. Concrete files vary per stack, but typically include:

- A dedicated `VERSION` file (devt promotes this pattern — single line, `X.Y.Z`).
- The changelog file (commonly `CHANGELOG.md` or `docs/API-CHANGELOG.md`).
- The package-manager manifest if your stack has one (`package.json`, `pyproject.toml`, `Cargo.toml`, `*.csproj`, etc.). If a lockfile exists, run an install so it re-syncs and commit it too.
- Any code-level constant or runtime exposure (e.g. `--version` flag, `/health` payload) that's hard-coded rather than derived.

All numeric values MUST match. CI pipeline guards typically reject main-bound merges where `VERSION` is not strictly greater than main's via `sort -V`.

**Common failure**: bumping only the changelog when merging into the integration branch, then having the integration → main PR rejected because `VERSION` (and any package manifest) is still at the old number. Also: language-specific helpers like `npm version` / `cargo set-version` only touch the manifest + lockfile + tag — they leave the `VERSION` file and the changelog stale.

---

## Quality Checklist

Before creating a PR:

- [ ] Code compiles / builds without errors
- [ ] All tests pass
- [ ] Linter / type-checker clean
- [ ] No dead code introduced
- [ ] Commit messages follow convention
- [ ] If version was bumped: every version source the project uses (VERSION, changelog, package manifest, runtime constants) shows the same `X.Y.Z` and any lockfile is committed
- [ ] PR description explains WHY, not just WHAT
