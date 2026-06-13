# Guardrails Reference — Common Violation Examples

Companion to `guardrails/golden-rules.md`. The Common Violation examples for each Golden Rule live here so the inline `<guardrails_inline>` block stays compact (per-dispatch token budget). The What/Why/Practice content stays inline in `golden-rules.md` because agents need it at decision time; concrete violation examples are useful as a reference / training set but don't need to be in every dispatch envelope.

See `guardrails/golden-rules.md` for the rule statements + rationale + practice instructions. This document only catalogues the violation patterns.

---

## Rule 1: Scan Before Implementing — Common violations

Creating a new utility function without checking if one already exists. Creating a new error class when the module already defines one. Writing a new interface when the owning service already exports one.

## Rule 2: No Backward Compatibility Code — Common violations

Keeping the old implementation "just in case" alongside the new one. Adding a `_v2` suffix instead of replacing the original. Wrapping old behavior in a flag so both paths exist.

## Rule 3: No Commented-Out Code — Common violations

Commenting out a block "for reference" during a refactor. Leaving a commented function call as a hint for future developers. Disabling a feature with `# TODO: re-enable this`.

## Rule 4: No TODO Comments — Common violations

`# TODO: handle edge case`. `pass  # implement later`. Returning a hardcoded value with a note to fix it. Adding `raise NotImplementedError` as a placeholder.

## Rule 5: Surgical Changes — Common violations

"Improving" comments or formatting in code you happened to read. Refactoring a function next to the one you were asked to change. Renaming a variable mid-task because the existing name is awkward. Deleting pre-existing dead code that predates your task.

## Rule 6: Bug Protocol — Common violations

"This test was already failing before my changes." "This is a pre-existing issue, not related to this PR." "I'll create a ticket for this." "This is out of scope for the current task."

## Rule 7: Validate Before Implementing — Common violations

Implementing a "fix" based on a review finding without checking if the code actually has that problem. Adding validation for an edge case that the framework already handles. Refactoring code based on a stale description of its behavior.

## Rule 8: Complexity/Benefit Evaluation — Common violations

Adding validation for a value that is already constrained by the type system. Wrapping every function call in try/catch "just in case." Creating an abstraction layer for something that has exactly one implementation.

## Rule 9: One Obvious Way — Common violations

Accepting both JSON arrays and comma-separated strings for the same parameter. Supporting both `snake_case` and `camelCase` in an API. Providing a convenience alias alongside the standard method.

## Rule 10: Evidence Before Claims — Common violations

"I've implemented the fix" without running the quality gates. "All tests pass" without actually running them. "The linting is clean" based on visual inspection of the code.

## Rule 11: Read Project Rules First — Common violations

Starting to write code immediately and discovering the project's naming convention halfway through. Using a pattern that the project explicitly forbids. Running the wrong test command because the project uses a non-standard setup.

## Rule 12: Surface Assumptions Before Implementing — Common violations

Reading "add validation" and silently choosing client-side over server-side. Reading "fix the bug" without verifying which behavior is correct. Inferring requirements from variable names instead of asking. Picking a library or pattern without confirming it fits the project's conventions.

## Rule 13: Minimum Viable Implementation — Common violations

Adding configuration options nobody requested. Building a generic abstraction layer for code with one caller. Adding new public methods alongside the requested change. Implementing 200 lines when 50 would meet the requirement.

## Rule 14: Pre-Flight Protocol — Common violations

Editing a file because "I know what it does" without reading the Brief. Proposing Redis caching when REJ-001 explicitly tombstoned that. Writing the PREFLIGHT scratchpad line AFTER the edit instead of before (defeats the hook's purpose). Treating a STALE Brief as if it were authoritative (it isn't — STALE means coverage is incomplete).

## Rule 15: Memory Maintenance Protocol — Common violations

Editing an ADR markdown but skipping `memory index`, leaving the index stale until the next `/devt:memory init`. Proposing an approach that matches a REJ's `search_keywords` because the suggestion path didn't query the rejected folder. Bulk-editing memory files without re-running validate.
