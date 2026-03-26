# Golden Rules

Universal development rules that apply to every project, every language, every framework. These are non-negotiable. Agents and workflows MUST follow these at all times. Project-specific rules in `.dev-rules/` and `CLAUDE.md` extend these but never override them.

---

## Rule 1: Scan Before Implementing

**What**: Always search the codebase for existing code before writing anything new. Never duplicate what already exists.

**Why**: Duplication creates maintenance burden, inconsistency, and confusion. Every duplicate is a future bug — when one copy gets updated and the other does not.

**Common violation**: Creating a new utility function without checking if one already exists. Creating a new error class when the module already defines one. Writing a new interface when the owning service already exports one.

**Practice**: Before writing any class, function, interface, or constant — search for it. Check adjacent modules, shared utilities, and base classes. If something similar exists, extend or reuse it.

---

## Rule 2: No Backward Compatibility Code

**What**: Delete obsolete code immediately when models change. Do not maintain parallel implementations, shims, or compatibility layers.

**Why**: Parallel implementations create confusion about which path is canonical. Dead code misleads future readers and agents. The codebase should reflect current reality, not historical versions.

**Common violation**: Keeping the old implementation "just in case" alongside the new one. Adding a `_v2` suffix instead of replacing the original. Wrapping old behavior in a flag so both paths exist.

**Practice**: When something changes, update it everywhere. Remove the old version. If rollback is needed, that is what version control is for.

---

## Rule 3: No Commented-Out Code

**What**: Code is either active or deleted. There is no in-between state.

**Why**: Commented-out code is invisible to linters, type checkers, and tests. It rots silently, becomes misleading, and clutters the codebase. Version control preserves history — comments should not.

**Common violation**: Commenting out a block "for reference" during a refactor. Leaving a commented function call as a hint for future developers. Disabling a feature with `# TODO: re-enable this`.

**Practice**: Delete it. If you need it later, `git log` has it. If you need to disable functionality, use a configuration flag, not comment syntax.

---

## Rule 4: No TODO Comments

**What**: All code must be complete and functional. No stub functions, empty classes, placeholder return values, or TODO markers.

**Why**: TODOs are promises without deadlines. They accumulate, become invisible, and signal incomplete work. Code that ships with TODOs is code that ships broken.

**Common violation**: `# TODO: handle edge case`. `pass  # implement later`. Returning a hardcoded value with a note to fix it. Adding `raise NotImplementedError` as a placeholder.

**Practice**: If the code needs something, implement it now. If it is out of scope for the current task, discuss with the user — do not leave a marker and move on.

---

## Rule 5: Boy Scout Rule

**What**: Leave code better than you found it, within the scope of the current task.

**Why**: Incremental improvement prevents decay. Small cleanups during normal work keep the codebase healthy without requiring dedicated refactoring sprints.

**Common violation**: Touching a file and ignoring the obvious style violation on the next line. Adding a function to a module with a broken import at the top. Working in a file that has a clearly wrong constant value and leaving it.

**Practice**: If you touch a file and see something clearly wrong — a typo, a dead import, a misnamed variable — fix it. Do not scope-creep into unrelated refactors, but do not walk past obvious problems either.

---

## Rule 6: Bug Protocol

**What**: Found a bug? Fix it now. Do not track it, defer it, label it "pre-existing," or file it for later.

**Why**: Labeling a bug as "not my problem" or "pre-existing" is rationalization for not doing the work. If you found it during your session, you own it. The cost of fixing a bug now is always lower than fixing it later.

**Common violation**: "This test was already failing before my changes." "This is a pre-existing issue, not related to this PR." "I'll create a ticket for this." "This is out of scope for the current task."

**Practice**: Investigate the root cause. Implement the fix. Verify it works. If the fix is genuinely large enough to derail the current task, surface it to the user with full context — but never silently defer.

---

## Rule 7: Validate Before Implementing

**What**: Verify that the problem actually exists before fixing it. Check assumptions against the actual codebase.

**Why**: Fixing problems that do not exist wastes time and can introduce real bugs. Reports, reviews, and agent findings may contain false positives. The codebase is the source of truth — not summaries of it.

**Common violation**: Implementing a "fix" based on a review finding without checking if the code actually has that problem. Adding validation for an edge case that the framework already handles. Refactoring code based on a stale description of its behavior.

**Practice**: Before implementing any fix: read the actual source code, verify the reported issue exists, confirm the current behavior, then implement. Evidence first, action second.

---

## Rule 8: Complexity/Benefit Evaluation

**What**: Evaluate whether a change is worth the complexity it introduces. Not every improvement improves the codebase.

**Why**: Well-intentioned defensive coding, speculative generalization, and theoretical edge case handling add complexity without proportional benefit. Code that is harder to read is harder to maintain.

**Common violation**: Adding validation for a value that is already constrained by the type system. Wrapping every function call in try/catch "just in case." Creating an abstraction layer for something that has exactly one implementation.

**Practice**: For every proposed change, ask: What is the actual risk this mitigates? How likely is the failure scenario? How much complexity does this add? If the benefit is theoretical and the cost is concrete, reconsider.

---

## Rule 9: One Obvious Way

**What**: Do not add multiple ways to accomplish the same thing. One canonical pattern per operation.

**Why**: Multiple approaches create decision fatigue, inconsistency, and maintenance burden. Every alternative path is a path someone will use wrong.

**Common violation**: Accepting both JSON arrays and comma-separated strings for the same parameter. Supporting both `snake_case` and `camelCase` in an API. Providing a convenience alias alongside the standard method.

**Practice**: Pick the canonical approach. Document it. Enforce it. Reject alternatives with clear error messages. If someone needs a different format, the answer is "use the standard format" — not "we also support this other thing."

---

## Rule 10: Evidence Before Claims

**What**: Run verification commands before claiming success. Never report that something works without proof.

**Why**: Confidence without verification is negligence. "It should work" is not the same as "it works." Quality gates, tests, and linters exist to catch what human review misses.

**Common violation**: "I've implemented the fix" without running the quality gates. "All tests pass" without actually running them. "The linting is clean" based on visual inspection of the code.

**Practice**: After every implementation: run linting, run type checking, run tests. Report the actual output. If something fails, fix it before reporting. The definition of "done" includes verified.

---

## Rule 11: Read Project Rules First

**What**: Always read `.dev-rules/` and `CLAUDE.md` before starting any work in a project. These contain the project's specific conventions, constraints, and quality gate commands.

**Why**: Every project has its own conventions. Working without reading them produces code that is correct in isolation but wrong for the project. Retrofitting conventions after the fact is expensive and error-prone.

**Common violation**: Starting to write code immediately and discovering the project's naming convention halfway through. Using a pattern that the project explicitly forbids. Running the wrong test command because the project uses a non-standard setup.

**Practice**: First action in any session: read the project's rule files. Internalize the conventions before touching any code. This takes 30 seconds and prevents hours of rework.
