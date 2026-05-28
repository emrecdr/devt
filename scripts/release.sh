#!/usr/bin/env bash
# Release a new devt version. Pushes commits + annotated tag in separate
# operations to avoid the bulk-push edge case where GitHub Actions release
# workflow can silently miss per-tag events (field: v0.58.1–v0.62.0 had to
# be backfilled manually). Verifies the release was created post-push;
# surfaces a fallback recovery command if the workflow didn't fire.
#
# Usage: bash scripts/release.sh X.Y.Z
#   e.g., bash scripts/release.sh 0.62.1
#
# Pre-requisites:
#   - VERSION + plugin.json + CHANGELOG.md already updated for this version
#   - Release commit already made on local main
#   - Working tree clean
#   - gh CLI authenticated (gh auth status)

set -euo pipefail

VERSION="${1:?usage: bash scripts/release.sh X.Y.Z}"
TAG="v${VERSION}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# Sanity checks — fail fast before any push.
if [ -n "$(git status --porcelain)" ]; then
  echo "ERROR: working tree not clean. Commit or stash before releasing."
  exit 1
fi

VFILE=$(tr -d '[:space:]' < VERSION)
if [ "$VFILE" != "$VERSION" ]; then
  echo "ERROR: VERSION file is '$VFILE', expected '$VERSION'. Bump it first."
  exit 1
fi

if ! grep -q "^## \[${VERSION}\]" CHANGELOG.md; then
  echo "ERROR: CHANGELOG.md missing '## [${VERSION}]' section."
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: gh CLI not installed. Install: https://cli.github.com/"
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "ERROR: gh CLI not authenticated. Run: gh auth login"
  exit 1
fi

if [ -n "$(git tag -l "$TAG")" ]; then
  echo "WARN: tag $TAG already exists locally; reusing."
fi

# Step 1 — push the release commit. CI runs on main push (smoke + lint).
echo "→ Pushing main to origin..."
git push origin main

# Step 2 — create an annotated tag if it doesn't exist. Annotated tags
# (object type 'tag') trigger workflows more reliably than lightweight
# tags (object type 'commit').
if [ -z "$(git tag -l "$TAG")" ]; then
  echo "→ Creating annotated tag $TAG..."
  git tag -a "$TAG" -m "Release $TAG"
fi

# Step 3 — push the single tag (NOT --tags). Per-tag pushes always fire
# the per-tag push event; bulk --tags pushes can miss events.
echo "→ Pushing tag $TAG to origin..."
git push origin "$TAG"

# Step 4 — wait briefly + verify the release workflow fired.
echo "→ Waiting 15s for the release workflow to start..."
sleep 15

if gh release view "$TAG" --json tagName >/dev/null 2>&1; then
  echo "✓ Release $TAG created on GitHub."
  echo "  View: $(gh release view "$TAG" --json url --jq .url)"
  exit 0
fi

# Workflow didn't fire (or hasn't completed yet). Show recovery path.
echo "⚠ Release $TAG NOT yet created on GitHub."
echo "  Recent workflow runs:"
gh run list --workflow=release.yml --limit 3 || true
echo
echo "  If the workflow didn't trigger at all, fall back to manual dispatch:"
echo "    gh workflow run release.yml -f tag=$TAG"
exit 1
