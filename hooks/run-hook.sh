#!/usr/bin/env bash
# Cross-platform hook wrapper
# Works on macOS, Linux, and Windows (via Git Bash bundled with Claude Code)
[[ $- == *i* ]] && return
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT_NAME="$1"
if [[ -z "$SCRIPT_NAME" ]]; then
  echo '{"error": "No hook script specified"}' >&2
  exit 1
fi
shift
if [[ ! -f "${SCRIPT_DIR}/${SCRIPT_NAME}" ]]; then
  echo "{\"error\": \"Hook script not found: ${SCRIPT_NAME}\"}" >&2
  exit 1
fi
exec "${SCRIPT_DIR}/${SCRIPT_NAME}" "$@"
