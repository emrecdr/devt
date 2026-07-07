# Golden Rules

Universal development rules that apply to every project, every language, every framework. These are non-negotiable. Agents and workflows MUST follow these at all times. Project-specific rules in `.devt/rules/` and `CLAUDE.md` extend these but never override them.

**Severity levels**: `[CRITICAL]` — prevents real bugs, wasted work, or false claims; violating blocks workflow. `[WARNING]` — code quality and maintenance risk; fix when feasible. `[STYLE]` — code cleanliness; nice-to-have, deprioritize under turn pressure.

> Concrete violation examples for each rule are catalogued in `docs/GUARDRAILS-REFERENCE.md`. The What/Why/Practice content stays inline because agents need it at decision time; the example reference is consulted only when pattern recognition is ambiguous.

---

## Rule 1: Scan Before Implementing `[CRITICAL]`

**What**: Always search the codebase for existing code before writing anything new. Never duplicate what already exists.

**Why**: Duplication creates maintenance burden, inconsistency, and confusion. Every duplicate is a future bug — when one copy gets updated and the other does not.

**Practice**: Before writing any class, function, interface, or constant — search for it. Check adjacent modules, shared utilities, and base classes. If something similar exists, extend or reuse it.

---

## Rule 2: No Backward Compatibility Code `[WARNING]`

**What**: Delete obsolete code immediately when models change. Do not maintain parallel implementations, shims, or compatibility layers.

**Why**: Parallel implementations create confusion about which path is canonical. Dead code misleads future readers and agents. The codebase should reflect current reality, not historical versions.

**Practice**: When something changes, update it everywhere. Remove the old version. If rollback is needed, that is what version control is for.

---

## Rule 3: No Commented-Out Code `[STYLE]`

**What**: Code is either active or deleted. There is no in-between state.

**Why**: Commented-out code is invisible to linters, type checkers, and tests. It rots silently, becomes misleading, and clutters the codebase. Version control preserves history — comments should not.

**Practice**: Delete it. If you need it later, `git log` has it. If you need to disable functionality, use a configuration flag, not comment syntax.

---

## Rule 4: No TODO Comments `[STYLE]`

**What**: All code must be complete and functional. No stub functions, empty classes, placeholder return values, or TODO markers.

**Why**: TODOs are promises without deadlines. They accumulate, become invisible, and signal incomplete work. Code that ships with TODOs is code that ships broken.

**Practice**: If the code needs something, implement it now. If it is out of scope for the current task, discuss with the user — do not leave a marker and move on.

---

## Rule 5: Surgical Changes `[WARNING]`

**What**: Touch only what the task requires. Clean up orphans your own changes create — not pre-existing ones.

**Why**: LLM agents tend to over-improve adjacent code, conflating "I noticed it" with "I should fix it." Drive-by edits create review noise, conflict with parallel work, and obscure the real change. Every modified line should trace directly to the user's request.

**Practice**: Modify only what is necessary to complete the task. If your changes leave dangling imports or unused symbols, remove those — they are your mess.

When you spot unrelated improvements or bugs (typos, dead code, stale comments, latent bugs, refactor opportunities, security smells), do NOT silently fix them. Instead, follow the **Find-Surface-Decide protocol**:

1. **Find**: Note the issue briefly — file path, one-line description, severity guess
2. **Surface**: Present it to the user as a side-finding, not a fait accompli
3. **Decide**: Ask whether to (a) fix now within this task, (b) split into a separate follow-up task, or (c) just record in the session summary and move on
4. **Act on the user's choice** — never assume which path applies

Match existing style even if you would write it differently. The Boy Scout instinct ("I noticed it, I should fix it") applies only with explicit user approval. Silent in-scope creep is the failure mode this rule guards against.

**Boy Scout mode (opt-in)**: Projects can grant blanket cleanup authority by setting `scope_mode: "boyscout"` in `.devt/config.json` (default is `"surgical"`). When `boyscout` mode is active, agents may auto-fix small mechanical issues — dead imports, lint warnings, typos in comments, formatting — within files they are already editing, without invoking Find-Surface-Decide. Anything larger (refactors, behavior changes, cross-file cleanups) still requires the protocol regardless of mode.

---

## Rule 6: Bug Protocol `[CRITICAL]`

**What**: Found a bug? Fix it now. Do not track it, defer it, label it "pre-existing," or file it for later.

**Why**: Labeling a bug as "not my problem" or "pre-existing" is rationalization for not doing the work. If you found it during your session, you own it. The cost of fixing a bug now is always lower than fixing it later.

**Practice**: Investigate the root cause. Implement the fix. Verify it works. If the fix is genuinely large enough to derail the current task, surface it to the user with full context — but never silently defer.

---

## Rule 7: Validate Before Implementing `[CRITICAL]`

**What**: Verify that the problem actually exists before fixing it. Check assumptions against the actual codebase.

**Why**: Fixing problems that do not exist wastes time and can introduce real bugs. Reports, reviews, and agent findings may contain false positives. The codebase is the source of truth — not summaries of it.

**Practice**: Before implementing any fix: read the actual source code, verify the reported issue exists, confirm the current behavior, then implement. Evidence first, action second.

---

## Rule 8: Complexity/Benefit Evaluation `[WARNING]`

**What**: Evaluate whether a change is worth the complexity it introduces. Not every improvement improves the codebase.

**Why**: Well-intentioned defensive coding, speculative generalization, and theoretical edge case handling add complexity without proportional benefit. Code that is harder to read is harder to maintain.

**Practice**: For every proposed change, ask: What is the actual risk this mitigates? How likely is the failure scenario? How much complexity does this add? If the benefit is theoretical and the cost is concrete, reconsider.

---

## Rule 9: One Obvious Way `[WARNING]`

**What**: Do not add multiple ways to accomplish the same thing. One canonical pattern per operation.

**Why**: Multiple approaches create decision fatigue, inconsistency, and maintenance burden. Every alternative path is a path someone will use wrong.

**Practice**: Pick the canonical approach. Document it. Enforce it. Reject alternatives with clear error messages. If someone needs a different format, the answer is "use the standard format" — not "we also support this other thing."

---

## Rule 10: Evidence Before Claims `[CRITICAL]`

**What**: Run verification commands before claiming success. Never report that something works without proof.

**Why**: Confidence without verification is negligence. "It should work" is not the same as "it works." Quality gates, tests, and linters exist to catch what human review misses.

**Practice**: After every implementation: run linting, run type checking, run tests. Report the actual output. If something fails, fix it before reporting. The definition of "done" includes verified.

---

## Rule 11: Read Project Rules First `[CRITICAL]`

**What**: Always read `.devt/rules/` and `CLAUDE.md` before starting any work in a project. These contain the project's specific conventions, constraints, and quality gate commands.

**Why**: Every project has its own conventions. Working without reading them produces code that is correct in isolation but wrong for the project. Retrofitting conventions after the fact is expensive and error-prone.

**Practice**: First action in any session: read the project's rule files. Internalize the conventions before touching any code. This takes 30 seconds and prevents hours of rework.

---

## Rule 12: Surface Assumptions Before Implementing `[CRITICAL]`

**What**: State assumptions explicitly before acting on them. When the task is ambiguous, present interpretations rather than picking one silently.

**Why**: Silent assumption is the most expensive failure mode in AI-assisted coding — agents pick a plausible interpretation, run with it, and produce code that solves the wrong problem. Surfacing the ambiguity costs one message; building the wrong thing costs hours.

**Practice**: Before implementing, explicitly list non-trivial assumptions. If two or more interpretations of the task are plausible, name them and ask the user to choose. If something is unclear, stop and ask — do not guess and run. Push back when a simpler approach exists or when the requested approach has a flaw.

---

## Rule 13: Minimum Viable Implementation `[WARNING]`

**What**: Write the minimum code that solves the stated problem. Nothing speculative, nothing for hypothetical future needs.

**Why**: Speculative features and pre-emptive abstractions add maintenance cost without users. "We might need this later" plumbing is almost always wrong about what later actually requires. Code that was not asked for is code that does not need to ship.

**Practice**: Implement exactly what was asked. Resist adding flexibility, configurability, or hooks that were not requested. If you finish the task and notice the code could be 4x shorter, rewrite it. The senior-engineer test: would a careful reviewer say this is overcomplicated? If yes, simplify.

## Rule 14: Pre-Flight Protocol `[CRITICAL]`

**What**: Before any non-trivial change, the **Two-Tier Pre-Flight Protocol** must run. Tier 1 (Topic Pre-Flight) — `/devt:preflight "<task>"` produces `.devt/state/preflight-brief.md` listing every governing ADR/Concept/Flow, all relevant REJ tombstones, related lessons, and (when Graphify is enabled) blast radius. Tier 2 (File Pre-Flight) — before each `Edit/Write`, append a `PREFLIGHT <ts> <action> <file> :: <governing IDs>` line to `.devt/state/scratchpad.md`. The PreToolUse `pre-flight-guard` hook checks for this line and warns (Phase 3 default) or blocks (Phase 4 default) the edit when missing.

**Why**: Without pre-flight, agents either miss prior architectural decisions (silent ADR violations), propose approaches the team has explicitly rejected (REJ tombstone hits), or burn tokens re-discovering the same context per agent. Pre-flight is a five-second discipline that catches the kinds of governance drift that compound into incidents over months.

**Practice**: Dev workflows auto-fire `/devt:preflight` at context_init — read `.devt/state/preflight-brief.md` FIRST. For each edit, write the PREFLIGHT line first, then call Edit/Write. If the file isn't in the Brief's scope, run the 5-Lane File Pre-Flight (`memory affects` + `memory query` + `memory active` + Graphify symbol/wiki where applicable), append findings to scratchpad, then `node bin/devt-tools.cjs preflight mark-stale "scope expanded to <file>"` so the next agent knows. See `skills/memory-pre-flight/SKILL.md` for the full protocol.

## Rule 15: Memory Maintenance Protocol `[CRITICAL]`

**What**: After editing any `.devt/memory/**.md` file, the FTS5 unified index must be rebuilt — `node bin/devt-tools.cjs memory index`. Before proposing any new ADR/Concept/Flow/REJ candidate (via `discovery suggest` or curator), the `rejected/` folder MUST be consulted for matching `search_keywords` — if a tombstone matches, the candidate is suppressed silently. The PostToolUse `memory-auto-index` hook handles the rebuild automatically when `auto_index_on_change: true` (the default); manual `memory index` is the fallback when the hook is disabled.

**Why**: A stale FTS5 index makes Pre-Flight queries return wrong results — agents proceed thinking governance has been read when it hasn't. REJ tombstones exist precisely so the team doesn't keep re-litigating the same rejected approach; bypassing tombstone checks reanimates settled debates.

**Practice**: Trust the PostToolUse hook for routine edits — it's idempotent. After bulk operations or when hooks are disabled, run `node bin/devt-tools.cjs memory index && node bin/devt-tools.cjs memory validate`. When generating proposals via `discovery suggest`, the tooling already filters against `rejected_keywords` — never bypass that filter manually. When curator promotes a DEC → ADR, it must check for matching REJs first; the curator skill body documents this filter.

---

## Rule 16: Never Weaken Tests to Pass `[CRITICAL]`

**What**: Never remove, skip, or weaken a failing test, gate, or assertion to make a run pass. Fix the code, not the test.

**Why**: Retry loops create exactly the pressure where deleting a failing test is the cheapest path to green. A deleted test cannot fail — pass/fail diffing is blind to it, so the gap ships silently as missing or buggy functionality.

**Practice**: If a test is genuinely wrong, say so explicitly in your output artifact (impl-summary / review) with the reason, and change it visibly — never silently. Deleting or skipping a test to satisfy a gate is gaming, not fixing; the verifier diffs test counts against the baseline and will flag it.
