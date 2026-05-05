#!/usr/bin/env bash
# Post-commit memory validation — lightweight Graphify-disabled fallback.
#
# v0.20.0+. Installed by setup.cjs into .git/hooks/post-commit ONLY when
# Graphify is NOT enabled. Runs `memory validate` and surfaces stale-path
# warnings to the developer right after each commit.
#
# When Graphify IS enabled, `graphify hook install` registers Graphify's own
# post-commit hook, which already covers stale symbol detection AND graph rebuild.
#
# Failures are logged but never block the commit (post-commit is informational).
set -u

# Find project root (walk up until .git/ is found)
DIR="$(pwd)"
while [ "$DIR" != "/" ]; do
  if [ -d "$DIR/.git" ]; then break; fi
  DIR="$(dirname "$DIR")"
done

if [ ! -d "$DIR/.devt/memory" ]; then
  exit 0
fi

# Probe for the devt-tools entry point
TOOLS=""
if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -f "$CLAUDE_PLUGIN_ROOT/bin/devt-tools.cjs" ]; then
  TOOLS="$CLAUDE_PLUGIN_ROOT/bin/devt-tools.cjs"
elif [ -f "$DIR/.claude/devt/bin/devt-tools.cjs" ]; then
  TOOLS="$DIR/.claude/devt/bin/devt-tools.cjs"
fi

if [ -z "$TOOLS" ]; then
  # No devt available — silent no-op. The commit still succeeds.
  exit 0
fi

# Run memory validate; surface errors/warnings to stderr but never fail
RESULT=$(node "$TOOLS" memory validate 2>/dev/null || echo '{"summary":{"errors":-1,"warnings":-1}}')
read -r ERRORS WARNINGS <<<"$(echo "$RESULT" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));const s=d.summary||{};console.log((s.errors||0)+' '+(s.warnings||0));" 2>/dev/null || echo "0 0")"

if [ "$ERRORS" -gt 0 ] || [ "$WARNINGS" -gt 0 ]; then
  echo ""
  echo "─── devt memory validate (post-commit) ───"
  echo "  errors: $ERRORS  warnings: $WARNINGS"
  echo "  Run \`node $TOOLS memory validate\` for details."
  echo "  (To install Graphify for richer post-commit checks: pip install graphifyy[mcp])"
  echo ""
fi

exit 0
