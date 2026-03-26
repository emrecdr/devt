# Fast — Inline Trivial Task

Execute small tasks directly without subagent overhead.

<purpose>
Skip the full pipeline for genuinely trivial tasks: typo fixes, config changes, simple additions.
If the task is too complex, redirect to /devt:implement.
</purpose>

<scope_gate>
Before executing, verify the task passes ALL of these:
- [ ] Touches 3 or fewer files
- [ ] No new patterns or abstractions needed
- [ ] No cross-module dependencies
- [ ] No API contract changes
- [ ] No database/schema changes
- [ ] Estimated: under 2 minutes of work

If ANY check fails: STOP. Tell the user: "This task is too complex for /fast. Use /devt:implement instead."
Do NOT proceed with a task that fails the scope gate.
</scope_gate>

---

<prerequisites>
- `.dev-rules/` directory exists with project conventions
- The user has provided a task description as the command argument
</prerequisites>

---

## Steps

<step name="init" gate="project conventions are loaded">

Read project conventions for context:
- Read `.dev-rules/coding-standards.md`
- Read `.dev-rules/quality-gates.md`
- Read `CLAUDE.md` if it exists

Do NOT initialize workflow state or write to `.devt-state/`. This is a lightweight path.

**Gate**: If `.dev-rules/` does not exist, warn the user and proceed with best-effort conventions.
</step>

<step name="scope_check" gate="all scope gate checks pass">

Evaluate the task against the scope gate criteria above.

Think through each check:
1. How many files will this touch? Count them.
2. Does this introduce new patterns, abstractions, or interfaces?
3. Does this cross module boundaries?
4. Does this change any API contract (request/response shapes, endpoints)?
5. Does this involve database schema or migration changes?
6. Can this realistically be done in under 2 minutes?

If ANY check fails:
- Report which check(s) failed
- Tell the user: "This task is too complex for /fast. Use /devt:implement instead."
- STOP. Do not proceed.

If all checks pass: proceed to execute.
</step>

<step name="execute" gate="changes are made">

Make the change directly. No subagents. No `.devt-state/` files.

Follow `.dev-rules/` conventions (coding standards, naming, patterns).
</step>

<step name="validate" gate="quality gates pass">

Run quality gate commands from `.dev-rules/quality-gates.md`.

If quality gates are not defined, run basic checks:
- Linting (if configured)
- Type checking (if configured)

If quality gates fail:
1. Fix the issue immediately (auto-fix for lint/type errors)
2. Re-run quality gates
3. If gates fail 3 times: STOP. Tell user: "Quality gates failed 3 times. This task may be too complex for /fast. Use /devt:implement instead."

Track iterations internally. Do NOT loop indefinitely.
</step>

<step name="report" gate="summary is reported to user">

Report what was changed:
- Files modified (absolute paths)
- Quality gates: pass/fail
- Done.

Keep the report concise. No artifacts, no state files.
</step>

---

<deviation_rules>
1. **Auto-fix: lint** — If linting fails during validate, fix it immediately. No iteration.
2. **STOP: complexity** — If during execute you discover the task is more complex than expected (e.g., requires touching more files, needs new patterns), STOP and tell the user to use /devt:implement.
3. **STOP: architecture** — If the change would require a design decision, STOP and ask the user.
</deviation_rules>

<red_flags>
- "I'll just do this quickly" on a complex task — Use /devt:implement
- "It's only a few more files" — If >3 files, it is not /fast
- "I'll skip the quality gates" — Never skip gates, even for /fast
</red_flags>

<success_criteria>
- Scope gate passed (all 6 checks)
- Changes are made and correct
- Quality gates pass
- Concise report delivered to user
</success_criteria>
