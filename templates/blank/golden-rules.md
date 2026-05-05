# Golden Rules

> Non-negotiable rules for all development work. Violations require immediate stop and correction.

## Quick Reference Card

| Rule | One-Liner |
|------|-----------|
| 1. Deep Analysis | Scan ALL related code BEFORE implementing |
| 2. No Duplicates | NEVER reimplement existing features or utilities |
| 3. No Backward Compat | Don't add legacy shims — update callers directly |
| 4. Surgical Changes | Modify only what the task needs; surface unrelated findings instead of silently fixing |
| 5. No TODOs/Markers | Complete code only — no placeholders |
| 6. Verify Before Done | No completion claims without test evidence |

---

## Rule 1: Deep Analysis Before Implementation

```
NO IMPLEMENTATION WITHOUT CODEBASE SCAN. NO EXCEPTIONS.
```

### Required Process

Before ANY implementation work:

1. **Scan target module**: Read existing files in the target area
2. **Scan shared utilities**: Check for helpers that already solve your subproblem
3. **Scan tests**: Existing tests reveal actual behavior, not just intent

### Violation Examples

- Implementing a helper that already exists in the codebase
- Creating a new wrapper when the project already has one
- Adding a new error type when an existing one covers the case

---

## Rule 2: No Duplicate Features

Search before creating. If a function, type, or pattern already exists — reuse it. If it doesn't fit exactly, extend it. Creating a parallel implementation is always wrong.

---

## Rule 3: No Backward Compatibility Code

Prefer direct changes over compatibility layers. No:

- Deprecated function aliases
- Feature flags for old behavior
- Compatibility shims between old and new APIs

Change the code, update all callers, delete the old path. If the project has external consumers, coordinate breaking changes — but don't add shims within the codebase itself.

---

## Rule 4: Surgical Changes

Touch only what the task requires. Clean up orphans **your own** changes create — not pre-existing ones.

When you spot unrelated improvements or bugs (typos, dead code, stale comments, latent bugs, refactor opportunities), do NOT silently fix them. Use the **Find-Surface-Decide protocol**:

1. **Find**: note the file path and a one-line description of the issue
2. **Surface**: present it to the user as a side-finding
3. **Decide**: ask whether to (a) fix now in this task, (b) split into a follow-up task, or (c) just record in the session summary
4. Act on the user's choice — never assume

Match existing style even if you would write it differently. Silent in-scope creep is the failure mode this rule guards against.

### Boy Scout Mode (opt-in)

`scope_mode` in `.devt/config.json` defaults to `"surgical"` (the protocol above). Set it to `"boyscout"` to grant agents permission to auto-fix small mechanical issues — dead imports, lint warnings, typos in comments, formatting — within files they are already editing, without asking. Anything larger (refactors, behavior changes, cross-file cleanups) still goes through Find-Surface-Decide regardless of mode.

---

## Rule 5: No TODOs or Placeholders

Ship complete code or don't ship. If you can't complete a function, surface it as BLOCKED in your summary.

---

## Rule 6: Verify Before Claiming Done

Before reporting DONE, run the project's quality gates and copy the terminal output as evidence. "I believe the tests pass" is not verification — "Here is the output showing 0 failures" is.

---

## Pre-Flight Protocol (v0.18.0+)

Before any non-trivial change, the **Two-Tier Pre-Flight Protocol** applies (see `${CLAUDE_PLUGIN_ROOT}/guardrails/golden-rules.md` Rule 14):

- **Tier 1 (Topic)**: dev workflows auto-fire `/devt:preflight "<task>"` at context_init, writing `.devt/state/preflight-brief.md`. Read the Brief FIRST — it lists every governing ADR/Concept/Flow + REJ tombstones for your task.
- **Tier 2 (File)**: before each Edit/Write, append a `PREFLIGHT <ts> edit <file> :: <governing IDs or 'no governance'>` line to `.devt/state/scratchpad.md`. The PreToolUse `pre-flight-guard` hook checks this — `memory.preflight_mode: block` (default v0.19.0+) denies the edit otherwise.

Project ADRs in `.devt/memory/decisions/` are **constitutional** — they override generic principles. Check `node bin/devt-tools.cjs memory affects <file>` if your edit isn't covered by the current Brief; run `/devt:preflight` again on scope expansion.
