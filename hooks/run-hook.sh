#!/usr/bin/env bash
# Backwards-compatibility redirect — run-hook.cmd is now the primary wrapper.
# This file exists so users with custom hooks referencing run-hook.sh still work.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec bash "${SCRIPT_DIR}/run-hook.cmd" "$@"
