#!/usr/bin/env bash
# verify-install.sh — confirm devt is properly installed via CC plugin manager.
#
# Usage:
#   bash scripts/verify-install.sh
#
# Run AFTER `/plugin install file:///path/to/devt` + CC restart.
# Reports PASS/FAIL per check + summary verdict.
#
# This script does not modify anything. Pure read-only diagnostic.

set -uo pipefail

PASS=0
FAIL=0
WARN=0
ROOT="${HOME}/.claude"

color_green() { printf "\033[32m%s\033[0m" "$1"; }
color_red()   { printf "\033[31m%s\033[0m" "$1"; }
color_yellow(){ printf "\033[33m%s\033[0m" "$1"; }

ok() { printf "  [%s] %s\n" "$(color_green PASS)" "$1"; PASS=$((PASS + 1)); }
no() { printf "  [%s] %s\n" "$(color_red FAIL)" "$1"; FAIL=$((FAIL + 1)); }
warn(){ printf "  [%s] %s\n" "$(color_yellow WARN)" "$1"; WARN=$((WARN + 1)); }

echo "== devt install verification =="
echo

# Check 1: devt registered in installed_plugins.json
if [ -f "${ROOT}/plugins/installed_plugins.json" ]; then
  DEVT_KEYS=$(/usr/bin/grep -oE '"devt[^"]*":' "${ROOT}/plugins/installed_plugins.json" 2>/dev/null | head -3)
  if [ -n "${DEVT_KEYS}" ]; then
    ok "devt registered in installed_plugins.json"
    echo "       Found keys: ${DEVT_KEYS}" | tr '\n' ' '
    echo
  else
    no "devt NOT registered in installed_plugins.json"
    echo "       Fix: run '/plugin install file:///Users/emrec/Projects/devt' in CC + restart"
  fi
else
  no "${ROOT}/plugins/installed_plugins.json missing — CC not initialized?"
fi

# Check 2: devt agents materialized at ~/.claude/agents/ (pattern A) OR loadable from plugin source (pattern B)
DEVT_AGENT_FILES=$(find "${ROOT}/agents/" -maxdepth 1 -name "devt-*.md" 2>/dev/null | wc -l | tr -d ' \n')
DEVT_AGENT_FILES=${DEVT_AGENT_FILES:-0}
if [ "${DEVT_AGENT_FILES}" -ge 11 ]; then
  ok "devt agents materialized at ~/.claude/agents/ (${DEVT_AGENT_FILES} files, pattern A)"
elif [ "${DEVT_AGENT_FILES}" -gt 0 ]; then
  warn "partial agent materialization: ${DEVT_AGENT_FILES} of 11 devt-*.md files at ~/.claude/agents/"
else
  warn "no devt-*.md files at ~/.claude/agents/ (may use pattern B — plugin-source load)"
fi

# Check 3: commands symlink (legacy) vs proper install
if [ -L "${ROOT}/commands/devt" ]; then
  warn "~/.claude/commands/devt is a symlink (legacy dev-mode install)"
  echo "       Target: $(readlink "${ROOT}/commands/devt")"
  echo "       If CC's plugin install completed cleanly this may be stale; consider removing"
elif [ -d "${ROOT}/commands/devt" ]; then
  ok "~/.claude/commands/devt is a directory (post-install state)"
fi

# Check 4: plugin source tree accessible
if [ -d "/Users/emrec/Projects/devt/.claude-plugin" ]; then
  ok "devt source tree at /Users/emrec/Projects/devt is intact"
else
  no "devt source tree missing at /Users/emrec/Projects/devt"
fi

# Check 5: devt CLI invokable via node (.cjs files don't need exec bit)
if [ -f "/Users/emrec/Projects/devt/bin/devt-tools.cjs" ]; then
  VER=$(node /Users/emrec/Projects/devt/bin/devt-tools.cjs update local-version 2>/dev/null | /usr/bin/grep -oE '"version":\s*"[0-9.]+"' | /usr/bin/grep -oE '[0-9.]+' | head -1 || echo "")
  if [ -n "${VER}" ]; then
    ok "devt CLI works (version: ${VER})"
  else
    warn "devt CLI present but didn't return version — verify with 'node /Users/emrec/Projects/devt/bin/devt-tools.cjs help'"
  fi
else
  no "devt CLI missing at /Users/emrec/Projects/devt/bin/devt-tools.cjs"
fi

# Check 6: hooks.json present in plugin source
if [ -f "/Users/emrec/Projects/devt/hooks/hooks.json" ]; then
  HOOK_COUNT=$(/usr/bin/grep -c '"matcher"' /Users/emrec/Projects/devt/hooks/hooks.json 2>/dev/null || echo 0)
  ok "hooks.json present with ${HOOK_COUNT} hook entries"
else
  no "hooks/hooks.json missing in plugin source"
fi

echo
printf "== Summary: "
[ "${PASS}" -gt 0 ] && printf "%s passed " "$(color_green ${PASS})"
[ "${WARN}" -gt 0 ] && printf "%s warning(s) " "$(color_yellow ${WARN})"
[ "${FAIL}" -gt 0 ] && printf "%s failed " "$(color_red ${FAIL})"
echo "=="

if [ "${FAIL}" -eq 0 ] && [ "${WARN}" -le 1 ]; then
  echo
  echo "VERDICT: devt install looks healthy. Next test — in a fresh CC session,"
  echo "         the Task tool's agent list should include devt:code-reviewer,"
  echo "         devt:programmer, etc. If those are missing, agents didn't register."
  exit 0
elif [ "${FAIL}" -eq 0 ]; then
  echo
  echo "VERDICT: install partially complete. Some warnings to address; agents may"
  echo "         still resolve via plugin-source load (pattern B)."
  exit 0
else
  echo
  echo "VERDICT: install broken. Fix the FAIL items above before testing."
  exit 1
fi
