#!/usr/bin/env bash
# Bash safety guard — PreToolUse hook on Bash tool calls.
#
# Two narrow rule families with zero legitimate dev use:
#   bash_destroy — filesystem-wipe patterns (rm -rf /, dd of=/dev/sd*, mkfs, …)
#   no_verify    — git operations that skip hooks (--no-verify) or GPG signing
#
# Hook exits with:
#   0 + "{}" stdout      → tool call proceeds (allow)
#   0 + {decision:"deny"} → blocks the call (deny — Claude Code hook contract)
#
# Reads JSON hook input from stdin. Robust to malformed input — fails open
# (exit 0 with "{}") on any parse error so a hook bug never blocks legitimate work.
[[ $- == *i* ]] && return
set -euo pipefail

if [ -t 0 ]; then
  # No stdin piped — nothing to check.
  echo '{}'
  exit 0
fi

INPUT="$(timeout 3 cat 2>/dev/null || true)"
if [[ -z "$INPUT" ]]; then
  echo '{}'
  exit 0
fi

# Delegate to the Node module via the CLI dispatcher. The module reads stdin
# directly, so we re-pipe INPUT through.
printf '%s' "$INPUT" | node "${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}/bin/devt-tools.cjs" bash-guard check 2>/dev/null || echo '{}'
