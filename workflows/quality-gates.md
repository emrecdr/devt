# Quality Gates Workflow

Run the project's quality gates (linting, type checking, tests) and report pass/fail per gate. No agents needed — the main session runs commands directly.

---

<prerequisites>
- `.devt/rules/quality-gates.md` exists with gate definitions
- `${CLAUDE_PLUGIN_ROOT}` is set (devt plugin is loaded)
- `node` is available on PATH
</prerequisites>

<available_agent_types>
This workflow does NOT use subagents. All steps are executed by the main session.

Available agent types in the devt system (for reference):

- `devt:programmer` — implementation specialist
- `devt:tester` — testing specialist
- `devt:code-reviewer` — code review specialist (READ-ONLY)
- `devt:architect` — structural review specialist (READ-ONLY)
- `devt:docs-writer` — documentation specialist
- `devt:retro` — lesson extraction specialist
- `devt:curator` — playbook quality maintenance specialist
  </available_agent_types>

<agent_skill_injection>
Not applicable — this workflow does not dispatch subagents.
</agent_skill_injection>

---

## Steps

<step name="load_gates" gate="quality-gates.md is read and gate list is extracted">

Read `.devt/rules/quality-gates.md` and extract all defined quality gates.

Each gate should have:

- **Name**: human-readable identifier (e.g., "Lint", "Type Check", "Unit Tests")
- **Command**: the exact shell command to run
- **Pass criteria**: what constitutes a pass (exit code 0, specific output pattern, etc.)

Also read `CLAUDE.md` if it exists — it may define additional gates or override defaults.

If `.devt/rules/quality-gates.md` does not exist:

- Check if `CLAUDE.md` defines quality commands (e.g., `make quality`, `npm run lint`, `go vet ./...`)
- If no gates are found anywhere, STOP with NEEDS_CONTEXT and ask the user to define quality gates

Build the ordered gate list. Gates run in the order they are defined.
</step>

<step name="execute_gates" gate="all gates have been executed">

Execute each quality gate in order. For each gate:

1. Print the gate name before running (so the user sees progress)
2. Run the command
3. Capture: exit code, stdout (last 50 lines), stderr (last 20 lines)
4. Record: PASS (exit code 0) or FAIL (non-zero exit code)
5. If FAIL: capture the relevant error output for the report

Do NOT stop on first failure — run ALL gates and report all results.

Track timing for each gate (start time, end time, duration).
</step>

<step name="report" gate="results are presented to the user">

Present results as a clear summary:

```
Quality Gates Report
====================

| # | Gate         | Status | Duration | Details          |
|---|--------------|--------|----------|------------------|
| 1 | Lint         | PASS   | 2.1s     |                  |
| 2 | Type Check   | PASS   | 4.3s     |                  |
| 3 | Unit Tests   | FAIL   | 12.7s    | 3 failures       |

Overall: 2/3 PASSED
```

For each FAILED gate, include:

- The first failure or error message (not the entire output)
- The specific file and line if available
- A brief suggestion for what to check

**Overall verdict**:

- ALL gates pass: report **ALL CLEAR** with total duration
- Any gate fails: report **ISSUES FOUND** with failure count and key errors
  </step>

---

<deviation_rules>

1. **Auto-fix: bugs** — Not applicable. This workflow only reports results; it does not fix issues.
2. **Auto-fix: lint** — Not applicable. Report only.
3. **Auto-fix: deps** — If a gate command is not found (e.g., `ruff` not installed), report it as FAIL with "command not found" and continue to the next gate.
4. **STOP: architecture** — If no quality gates are defined anywhere (no `.devt/rules/quality-gates.md`, no `CLAUDE.md` gates), STOP with NEEDS_CONTEXT.
   </deviation_rules>

<success_criteria>

- All defined quality gates have been executed
- Results are reported per gate with pass/fail status and duration
- Failed gates include actionable error details
- Final status: **DONE** (regardless of gate pass/fail — the workflow's job is to report, not fix)
  </success_criteria>
