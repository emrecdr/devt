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

## Version Bump — Keep Sources In Sync

When a PR introduces a change that justifies a new version, bump **every** version source the project uses in the same commit. Concrete files vary per project, but typically include:

- A dedicated `VERSION` file (devt promotes this pattern — single line, `X.Y.Z`).
- The changelog file (commonly `docs/API-CHANGELOG.md` or `CHANGELOG.md`).
- The package-manager manifest, if the stack has one (for Node/TypeScript this is usually `package.json`'s top-level `"version"`). If a lockfile exists, run an install so it re-syncs and commit it too.
- Any code-level constant or runtime exposure that's hard-coded rather than derived.

All numeric values MUST match. CI pipeline guards typically reject main-bound merges where `VERSION` is not strictly greater than main's via `sort -V`. See [`./api-changelog.md`](./api-changelog.md) for the full rule.

**Common failure**: bumping only the changelog when merging into the integration branch, then having the integration → main PR rejected because `VERSION` (and any package manifest) is still at the old number. Also: language-specific helpers like `npm version` only touch the manifest + lockfile + tag — they leave the `VERSION` file and the changelog stale.

---

## Quality Checklist

Before creating a PR:

- [ ] Lint clean: `npx eslint .`
- [ ] Types clean: `npx tsc --noEmit`
- [ ] Tests pass: `npx vitest run` (or `npx jest --ci`)
- [ ] No dead code introduced
- [ ] No `any` types introduced
- [ ] Commit messages follow convention
- [ ] PR description explains WHY
- [ ] If version was bumped: every version source the project uses (VERSION, changelog, package manifest, runtime constants) shows the same `X.Y.Z` and any lockfile is committed
