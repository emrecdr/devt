#!/usr/bin/env bash
# Shared hook runtime — sourced by every stdin-consuming hook.
#
# Hooks are spawned by run-hook.js as `bash <hook>` with the event JSON piped on
# stdin and PLUGIN_ROOT exported. Historically each hook re-implemented the same
# stdin capture inline; the fixes that moved that read off `process.argv` (an
# E2BIG hazard on large payloads) had to be applied hook-by-hook. Centralizing
# the read here makes that class un-reintroducible: a new hook sources this and
# gets the correct, guarded read for free.
#
# Not a hook itself — defines functions only, safe to source under `set -euo
# pipefail`. Callers keep their own empty-input action (an allow-hook echoes
# '{}' before exit; others exit silently) since that is hook-specific.

# devt_read_stdin [timeout_secs] — echo the piped hook JSON, or nothing.
# tty-guarded (a hook run directly on a terminal must not block on `cat`) and
# time-boxed, so a stalled producer can never hang the parent tool call. The
# `|| true` keeps it errexit-safe when the read times out or `timeout` is absent.
devt_read_stdin() {
  [ -t 0 ] && return 0
  timeout "${1:-3}" cat 2>/dev/null || true
}

# devt_plugin_root — the devt plugin root. Prefers the value run-hook.js already
# resolved and exported (PLUGIN_ROOT), then the harness-set CLAUDE_PLUGIN_ROOT
# (the same env contract several hooks' inner node blocks read directly); falls
# back to this file's parent so the helper still works when a hook is invoked
# directly (tests, manual runs).
devt_plugin_root() {
  printf '%s' "${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}}"
}
