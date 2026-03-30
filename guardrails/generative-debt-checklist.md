# Generative Debt Checklist

Quality gates at three stages of implementation. Generative debt is the technical debt introduced by AI-assisted coding — hallucinated patterns, missed conventions, orphaned code, skipped validations. These checkpoints prevent it.

---

## BEFORE Coding

Run these checks before writing any implementation code.

- [ ] **Read project rules**: `.devt/rules/` and `CLAUDE.md` loaded and internalized
- [ ] **Scan codebase**: Searched for existing implementations related to the task
- [ ] **Verify requirements**: Task specification is clear and unambiguous — no assumptions
- [ ] **Check conventions**: Naming patterns, file structure, and architectural layers identified from adjacent code
- [ ] **Identify reusable code**: Base classes, shared utilities, existing interfaces found
- [ ] **Confirm the problem exists**: If fixing a bug or review finding, verified it is real (Rule 7)

**Gate**: Do not write code until all boxes are checked. Skipping the scan is how duplicates are born.

**Common failures at this stage**:
- Creating a new utility when one already exists three directories away
- Misunderstanding the task and implementing the wrong thing
- Using a pattern from a different project that conflicts with this project's conventions

---

## DURING Coding

Follow these practices while implementing.

- [ ] **Follow discovered conventions**: Using the naming, structure, and patterns found during scan
- [ ] **No new patterns without cause**: If the codebase does X one way, do X the same way
- [ ] **Run quality gates incrementally**: After completing each logical unit, run linting and type checking — do not batch all checks to the end
- [ ] **Self-review as you go**: Re-read each function after writing it — would a reviewer accept this?
- [ ] **Complete implementations only**: No TODOs, no placeholders, no stubs, no "implement later"
- [ ] **Imports at top level**: No inline imports (unless test-specific mocks)
- [ ] **Error handling uses project hierarchy**: Custom errors inherit from the project's base error classes

**Gate**: If a quality gate fails during implementation, fix it immediately. Do not accumulate failures.

**Common failures at this stage**:
- Inventing a new naming convention instead of matching the existing one
- Leaving a placeholder "to clean up later" that never gets cleaned up
- Writing an entire feature before discovering the linter rejects the style

---

## AFTER Coding

Run these checks after implementation is complete, before reporting done.

- [ ] **Full quality gate pass**: All linting, type checking, and test commands pass cleanly
- [ ] **Test coverage**: New code has tests; modified code has updated tests
- [ ] **No orphaned code**: If you renamed or moved something, all references are updated
- [ ] **No dead imports**: Every import is used; no unused imports remain
- [ ] **Documentation updated**: Module docs, API docs, and changelogs reflect the changes
- [ ] **Evidence captured**: Actual command output from quality gates is available — not just "I ran it"

**Gate**: "Done" means verified. Report the actual output of quality gates, not your expectation of what they would produce.

**Common failures at this stage**:
- Reporting "all tests pass" without running them
- Forgetting to update a module documentation file after changing its interface
- Leaving a renamed function referenced under its old name in a test file
