#!/usr/bin/env bash
# Extract a single version's section from CHANGELOG.md for use as release notes.
# Usage: scripts/extract-changelog.sh <version>
#   e.g., scripts/extract-changelog.sh 0.9.3
# Prints the section body (without the "## [X.Y.Z] - DATE" header) to stdout.
# Exits non-zero if the version is not found.
set -euo pipefail

VERSION="${1:?usage: extract-changelog.sh <version>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHANGELOG="${ROOT}/CHANGELOG.md"

[ -f "$CHANGELOG" ] || { echo "CHANGELOG.md not found at $CHANGELOG" >&2; exit 2; }

awk -v ver="$VERSION" '
  BEGIN { in_section = 0; found = 0 }
  /^## \[/ {
    if (in_section) { in_section = 0 }
    if ($0 ~ "^## \\[" ver "\\]") { in_section = 1; found = 1; next }
  }
  in_section { print }
  END { exit found ? 0 : 1 }
' "$CHANGELOG" | awk '
  # Strip leading and trailing blank lines
  /^$/ { if (!seen) next; blanks = blanks "\n" }
  /[^[:space:]]/ { printf "%s%s\n", blanks, $0; blanks = ""; seen = 1 }
'
