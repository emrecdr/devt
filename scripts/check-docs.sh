#!/usr/bin/env bash
# Check documentation completeness against .devt/rules/documentation.md.
# Extracts required doc paths and section headings, verifies they exist.
set -uo pipefail

DOC_RULES=".devt/rules/documentation.md"

if [[ ! -f "$DOC_RULES" ]]; then
  echo "No documentation rules found at $DOC_RULES"
  echo "Run /devt:init to scaffold .devt/rules/ first."
  exit 1
fi

PASSED=0
FAILED=0
TOTAL=0

echo "Checking documentation against $DOC_RULES"
echo ""

# Extract required file paths (lines matching "- path/to/file.md" or "- `path/to/file.md`")
while IFS= read -r line; do
  # Match lines like "- path/to/something.md" or "- `path/to/something.md`"
  FILE_PATH=$(echo "$line" | sed -n 's/^[[:space:]]*-[[:space:]]*`\{0,1\}\([^`]*\.md\)`\{0,1\}[[:space:]]*$/\1/p')
  if [[ -z "$FILE_PATH" ]]; then
    # Also try matching paths with descriptions: "- path/to/file.md — description"
    FILE_PATH=$(echo "$line" | sed -n 's/^[[:space:]]*-[[:space:]]*`\{0,1\}\([^`[:space:]]*\.md\)`\{0,1\}[[:space:]].*/\1/p')
  fi

  if [[ -n "$FILE_PATH" ]]; then
    TOTAL=$((TOTAL + 1))
    if [[ -f "$FILE_PATH" ]]; then
      echo "  FOUND: $FILE_PATH"
      PASSED=$((PASSED + 1))
    else
      echo "  MISSING: $FILE_PATH"
      FAILED=$((FAILED + 1))
    fi
  fi
done < "$DOC_RULES"

echo ""

# Extract required sections (lines matching "## Required sections:" followed by "- Section Name")
IN_SECTIONS=false
while IFS= read -r line; do
  if echo "$line" | grep -qiE '^##.*required.*section'; then
    IN_SECTIONS=true
    continue
  fi

  # Stop at next heading
  if [[ "$IN_SECTIONS" == true ]] && echo "$line" | grep -qE '^#'; then
    IN_SECTIONS=false
    continue
  fi

  if [[ "$IN_SECTIONS" == true ]]; then
    SECTION=$(echo "$line" | sed -n 's/^[[:space:]]*-[[:space:]]*\(.*\)/\1/p')
    if [[ -n "$SECTION" ]]; then
      echo "  Required section: $SECTION (manual check needed)"
    fi
  fi
done < "$DOC_RULES"

echo ""
echo "=== Documentation Check: $PASSED/$TOTAL files found, $FAILED missing ==="

if [[ $FAILED -gt 0 ]]; then
  exit 1
fi
