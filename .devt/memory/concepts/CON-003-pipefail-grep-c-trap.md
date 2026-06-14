---
id: CON-003
title: Pipefail + grep-c Empty Match Silent-Kill Trap
doc_type: concept
status: active
confidence: verified
domain: smoke-tests
summary: Under `set -euo pipefail`, pipelines ending in `grep -c <pattern>` exit non-zero when there are zero matches (grep's exit-1-on-no-matches behavior). When this happens inside `$(...)` command substitution, the subshell exits non-zero, the parent's `set -e` fires, and the smoke test dies silently between gates with no FAIL message. Caught 4 times across the v0.93 cycle. Defuse with `set +eo pipefail` inside the subshell — set +e alone is not enough because pipefail propagates independently.
keywords:
  - pipefail
  - set-e
  - grep-c
  - smoke-test
  - silent-failure
  - subshell
  - command-substitution
  - bash-trap
affects_paths:
  - scripts/smoke-test.sh
  - hooks/dispatch-hygiene-guard.sh
  - hooks/task-truncation-detector.sh
created_at: 2026-06-14
created_by: emre
schema_version: 1
---

# Pipefail + grep-c Empty Match Silent-Kill Trap

`scripts/smoke-test.sh` declares `set -euo pipefail` at line 14. This combination is correct for production scripts but creates a specific failure mode when smoke gates need to capture exit codes or match counts from CLI invocations that may legitimately return non-zero.

## The trap mechanics

```bash
# Inside a smoke gate:
COUNT=$(node bin/devt-tools.cjs some-cli --bad-flag 2>&1 | grep -c "error message")
```

Under `set -euo pipefail`:

1. `node ... --bad-flag` exits 2 (intentional — input validation rejects bad flag).
2. The pipeline `node | grep -c` enters pipefail propagation: pipefail makes the pipeline exit with the rightmost non-zero exit code.
3. If grep finds a match → grep exits 0 → pipeline exit = 2 (from node, propagated via pipefail).
4. If grep finds NO match → grep exits 1 → pipeline exit = 2 (still from node).
5. Either way the pipeline exits non-zero.
6. Inside the `$(...)` command substitution, the subshell exits non-zero.
7. `set -e` in the PARENT script fires on the failed substitution.
8. The smoke script dies SILENTLY between gates — no FAIL message, no result echo, no indication that the next gate was even reached.

This is the worst possible failure mode: assertions pass; subsequent gates never run; CI reports green if it only checks `[[ $FAIL -eq 0 ]]` because PASS counter doesn't decrement (it just doesn't increment).

## Field-validated instances (4 in v0.93 cycle)

| Gate / context | Pipeline shape | Symptom | Fix shipped |
|---|---|---|---|
| **K98** (Phase 2.6) | `do.md ↔ devt-coordinator.md` route diff via `comm -23 <(awk) <(awk)` | Smoke died after K97; K98 onwards silent | Wrapped diff in `\|\| true` defuser |
| **K103** (Phase 11) | `comm -23 <(echo "$VALID") <(echo "$NEXT") \| grep -v '^$' \| tr '\n' ',' \| sed 's/,$//'` × 3 separate checks | Smoke died between K102 and K103; "K103 absent" mystery | Added `\|\| true` at end of each `comm`/grep/tr/sed chain |
| **K104 extension** (this cycle) | `node "$CLI" dispatch warnings --since=garbage 2>&1 1>/dev/null \| grep -c "invalid --since"` | Smoke died between K103 and K104; new tests for input validation invisible | `set +eo pipefail` inside each `$(...)` subshell |
| **K109** (cal #21 A2b) | Hook fixture: `echo '{...}' \| bash hooks/task-truncation-detector.sh 2>&1 \| grep -c "raw_dispatch incident"` | Smoke died between K108 and K109 first attempt | `set +eo pipefail` inside subshell |

The K104 + K109 instances confirmed that `set +e` alone is INSUFFICIENT: pipefail propagates independently. Both must be disabled together via `set +eo pipefail`.

## How to recognize the class

The trap fires when a smoke gate does **any** of:

1. **Captures exit code from a CLI that may exit non-zero.** Pattern: `EXIT=$(cmd >/dev/null 2>&1; echo $?)` — the `cmd` failing under `set -e` kills the subshell before `echo $?` runs.
2. **Counts matches via `grep -c`.** Pattern: `COUNT=$(stuff | grep -c "...")` — if grep finds zero matches, exit 1 propagates via pipefail.
3. **Pipes through `comm -23` or `comm -13`.** Pattern: `MISSING=$(comm -23 <(a) <(b) | filter)` — if comm produces empty output AND filter exits non-zero on empty input (grep -v '^$', for instance), pipefail propagates.
4. **Filters via `grep -v` with an unlikely-to-match pattern.** Same root: zero matches → exit 1.

If a smoke gate test silently disappears between runs (FAIL count unchanged but gate name absent from output), check whether any captures fit one of these shapes.

## Defuse pattern

Use `set +eo pipefail` at the START of every `$(...)` subshell that contains CLI invocations or pipelines that may legitimately exit non-zero:

```bash
# Right
EXIT_CODE=$(set +eo pipefail; cd "$TEST_TMP"; node "$CLI" cmd --bad >/dev/null 2>&1; echo $?)
MATCH_COUNT=$(set +eo pipefail; cd "$TEST_TMP"; node "$CLI" cmd --bad 2>&1 | grep -c "expected error")

# Wrong (loses signal on legitimate non-zero, silent kill)
EXIT_CODE=$(cd "$TEST_TMP" && node "$CLI" cmd --bad >/dev/null 2>&1; echo $?)
MATCH_COUNT=$(cd "$TEST_TMP" && node "$CLI" cmd --bad 2>&1 | grep -c "expected error")
```

`set +e` on its own is INSUFFICIENT. `set +o pipefail` on its own is INSUFFICIENT (set -e still kills the subshell on the FIRST non-zero command before the pipeline runs). Both must be disabled together.

Alternative defuser when the subshell shape allows: append `|| true` to the failing command. But this LOSES the exit code, so it only works when you don't need to capture it. The smoke test pattern needs exit codes, so `set +eo pipefail` is the correct tool.

## Reference templates

K104's input-validation tests (smoke-test.sh:~12420) and K109's hint-emit fixture (smoke-test.sh:~12549) are the canonical reference implementations. Both use the `set +eo pipefail` defuser inside each capture subshell and validate exit codes + stderr match counts independently.

When writing a new smoke gate that captures any of:
- Exit code of a CLI expected to fail
- Match count from a pattern that may have zero matches
- Output diff via `comm`/`diff` that may be empty

... copy the K104/K109 capture pattern. Do NOT use bare `$()` substitutions for these shapes.

## Why this isn't a bash bug

This is correct bash behavior. `set -e` + `pipefail` + `errexit-in-substitution` are all individually correct; together they implement strict error propagation. The trap is that smoke test patterns FREQUENTLY need to capture intentional non-zero exits — exit code testing IS the assertion. The correct solution isn't to disable the error-propagation discipline (which catches real bugs elsewhere in the script) but to scope-disable it inside the specific subshells that test for non-zero exits.

## Cross-references

- `scripts/smoke-test.sh:14` — the global `set -euo pipefail`
- `scripts/smoke-test.sh:K98` — first instance + `|| true` defuser (Phase 2.6)
- `scripts/smoke-test.sh:K103` — second instance + `|| true` defuser (Phase 11)
- `scripts/smoke-test.sh:K104` — third instance + `set +eo pipefail` defuser (this cycle)
- `scripts/smoke-test.sh:K109` — fourth instance + `set +eo pipefail` defuser (cal #21)
