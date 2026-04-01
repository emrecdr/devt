---
name: verification-patterns
description: >-
  Use to verify that finished implementation is REAL and CONNECTED — not stubs, placeholders, or dead code.
  4-level verification: exists, substantive, wired, functional. Trigger on "is this actually working",
  "verify everything is connected", "check completeness", "detect stubs", "any TODO markers or empty
  functions", "is it wired up", "are these real implementations or placeholders", "confirm it's not dead
  code", "check if imported anywhere", "is the route registered", "returning placeholder objects",
  "hardcoded test values", "before I mark this done", "before I tell the team it's ready", "before we ship",
  "double-check that claim", "is the function called from anywhere", "still stubbed", "half-done",
  "NotImplementedError hiding", "empty function bodies", "return null where real data expected." This is
  about checking if COMPLETED work is genuine and connected — not about scanning for existing code before
  building (use codebase-scan), not about scoring code quality or finding security issues (use
  code-review-guide), and not about writing tests (just write them).
---

# Verification Patterns

## Overview

The most common failure in AI-generated code is "looks done but isn't" — files exist but contain stubs, functions are defined but never called, features are coded but not wired into the system.

## The Iron Law

```
LEVEL 3 MINIMUM FOR ALL ARTIFACTS BEFORE CLAIMING DONE
```

The most common failure mode in AI-assisted development is code that exists but is not connected to anything — a function defined but never imported, a route registered but missing its handler, a service created but not wired into dependency injection. Level 3 (wired) catches these disconnected artifacts that pass superficial review but fail at runtime. Without this minimum bar, "done" means "files exist" rather than "feature works."

Code that exists (L1) but is not wired into the system (L3) is not done. "File is there" is not evidence of completion. Trace imports, check registration, verify reachability.

## The 4 Levels

### Level 1: Exists

- File is present at expected path
- Has non-zero size
- Is not a copy of a template with no modifications

### Level 2: Substantive

Content is real implementation, not placeholder. Scan for:

- `# TODO`, `# FIXME`, `# HACK`
- Empty function bodies: `pass`, `return null/undefined`, `return nil`, `{}`
- Explicit not-implemented markers: `raise NotImplementedError`, `throw new Error("not implemented")`, `panic("not implemented")`
- `return {}`, `return []`, `return ""` where real data expected
- `"placeholder"`, `"example"`, `"test"` as return values
- Functions with only a docstring and no implementation
- Empty catch/except blocks

### Level 3: Wired

Connected to the rest of the system:

- Is the file imported somewhere?
- Is the function/class called from another module?
- Is the route registered in the router?
- Is the service injected via dependency injection?
- Is the test actually run by the test runner?

### Level 4: Functional

Actually works when invoked:

- Tests pass (not just exist)
- Quality gates pass
- Manual smoke test succeeds (if applicable)

## Gate Function

Before reporting ANY completion status, follow this flow exactly:

```
1. IDENTIFY: What command or check proves this artifact works?
2. RUN: Execute the command fresh — no assumptions from earlier runs
3. READ: Capture the FULL output — not a summary, the actual text
4. CHECK: Exit code, error counts, specific success indicators
5. VERIFY: Does the output LITERALLY show what you claim?
   - Claim "tests pass" → output must show "N passed, 0 failed"
   - Claim "code is wired" → grep output must show the import
   - Claim "endpoint works" → output must show successful invocation
6. DECIDE:
   - Output matches claim → report with evidence (quote the output)
   - Output contradicts claim → fix the code, re-run, report actual state
   - Output is unclear → run again, read more carefully

Skip any step = lying, not verifying.
```

Before reporting DONE, verify ALL artifacts at Level 3 minimum:

1. List every file you created or modified
2. For each: confirm Level 1 (exists), Level 2 (no stubs), Level 3 (wired)
3. Run tests for Level 4
4. If ANY artifact fails Level 2 or 3, fix it before reporting

### Stub Detection Examples

Look for these patterns in any language:

```
// STUB: empty body
process_payment(amount) { }         // does nothing

// STUB: always-true / always-null return
validate_email(email) { return true }    // never rejects
get_user(user_id) { return null }        // never fetches

// STUB: explicit not-implemented
process_order(order) { throw NotImplementedError }

// STUB: empty collection where real data expected
config = {}                              // missing real config
```

The language syntax varies, but the pattern is the same: a function that exists but does no real work.

### Vue Stub Detection

```
// STUB: template-only component with no logic
<template><div>TODO</div></template>
<script setup></script>

// STUB: composable returning empty object
export function useFeature() { return {} }

// STUB: Pinia store with no state or actions
export const useFeatureStore = defineStore('feature', () => ({ }))
```

## Anti-patterns

| Don't                              | Why It Fails                                        | Do Instead                                               |
| ---------------------------------- | --------------------------------------------------- | -------------------------------------------------------- |
| "The file is there, that's enough" | Exists (L1) does not mean Substantive (L2)          | Scan for stubs, pass, NotImplementedError, empty returns |
| "I'll wire it up later"            | Unwired code is dead code -- it will never be wired | Wire it NOW. Verify imports and registrations.           |
| "The test exists"                  | Written does not mean Passing                       | Run the test. Check Level 4.                             |
| "It should work"                   | "Should" is not evidence                            | Run it. Show output. Evidence before claims.             |
| "It compiles"                      | Compiles does not mean Functional                   | Compilation catches syntax, not logic. Test behavior.    |
| "The function is defined"          | Defined does not mean Called                        | Grep for call sites. If zero, it is dead code.           |

## When NOT to Use

Skip for documentation-only changes or configuration updates where "wired and functional" doesn't apply.

## Time Budget

Level 1-2 (Exists + Substantive): 1 minute. Level 3-4 (Wired + Functional): 3-5 minutes.

## Integration

Use with: codebase-scan (before), code-review-guide (after)
Related: programmer agent self-check, tester agent coverage verification
