# UI Presentation Protocol

Output formatting standards for workflow phases, agent status, and user-facing messages. Consistent presentation makes multi-step workflows legible. The user should always know: what phase they are in, what is happening, and what happens next.

---

## Phase Transitions

When a workflow moves from one phase to the next, display a transition block:

```
--- Phase 3/7: Testing ---
Spawning tester agent...
```

Format: `--- Phase {n}/{total}: {PhaseName} ---` followed by a one-line description of what is starting.

If the phase involves an agent, state which agent: `Spawning {agent_type} agent...`
If the phase is executed by the main session: `Running {action}...`

---

## Autonomous Mode

When the workflow is running autonomously (no user intervention needed between phases):

- **Gate passes (score >= 80)**: Auto-proceed to the next phase. Display:

  ```
  Gate passed (score: 87/100). Proceeding to Phase 4/7...
  ```

- **Gate fails (score < 80)**: Pause and display:

  ```
  Gate failed (score: 62/100). 3 issues found:
  1. [issue summary]
  2. [issue summary]
  3. [issue summary]

  Entering fix loop...
  ```

- **Gate threshold**: 80 is the default. Projects may override this in `.devt/rules/quality-gates.md`.

---

## Fix Loop Display

When a fix-review cycle is in progress:

```
Fix iteration 2/3: code-reviewer found 3 issues
  - [file:line] issue description
  - [file:line] issue description
  - [file:line] issue description
Applying fixes...
```

After fixes are applied and re-validated:

```
Fix iteration 2/3: complete. Re-running quality gates...
```

If the fix loop exhausts its iterations (default: 3):

```
Fix loop exhausted (3/3 iterations). Escalating to user.
Summary:
  - Iteration 1: 5 issues found, 5 fixed
  - Iteration 2: 3 issues found, 3 fixed
  - Iteration 3: 2 issues found, 2 remain
Remaining issues:
  1. [issue detail]
  2. [issue detail]
```

---

## Workflow Completion

When all phases are done, display a summary table:

```
Workflow complete.

| Phase | Name         | Status | Detail                          |
|-------|--------------|--------|---------------------------------|
| 1/7   | Scan         | PASS   | 12 files analyzed               |
| 2/7   | Implement    | PASS   | 4 files changed, 127 lines      |
| 3/7   | Test         | PASS   | 8 tests added, all passing       |
| 4/7   | Review       | PASS   | Score: 91/100                    |
| 5/7   | Fix          | SKIP   | No issues from review            |
| 6/7   | Docs         | PASS   | MODULE.md updated                |
| 7/7   | Retro        | PASS   | 2 lessons extracted              |
```

Status values: `PASS`, `FAIL`, `SKIP` (phase was not needed), `BLOCKED` (escalated to user).

---

## Error Display

When an error occurs, always include three things:

```
Error in Phase 3/7: Testing
  What failed: Unit test command exited with status 1
  Why: 2 test failures in test_user_service (lines 45, 78)
  Next step: Fix failing assertions, then re-run tests
```

Never display just "an error occurred." The user needs what, why, and what to do about it.

---

## Agent Status

When reporting on a completed subagent:

```
programmer: DONE (4 files changed, quality gates passed)
```

Format: `{agent_type}: {STATUS} ({summary})`

Status values:

- `DONE` — agent completed successfully
- `NEEDS_WORK` — agent completed but output needs revision
- `BLOCKED` — agent could not proceed (requires user input)
- `FAILED` — agent encountered an unrecoverable error

If multiple agents run in a workflow, provide a consolidated view:

```
Agent summary:
  programmer:    DONE (4 files changed)
  tester:        DONE (8 tests added)
  code-reviewer: DONE (score: 91/100, PASS)
  docs-writer:   DONE (1 file updated)
```

---

## Progress Indicators

For long-running operations, provide periodic status:

```
Running unit tests... (47/120 passed, 0 failed)
```

For operations where total count is unknown:

```
Scanning codebase... (found 23 relevant files so far)
```

Do not leave the user staring at silence. If an operation takes more than a few seconds, show what is happening.

---

## Formatting Rules

- Use monospace/code blocks for commands, file paths, and agent output
- Use tables for structured multi-item summaries
- Use numbered lists for ordered sequences (steps, issues)
- Use bullet lists for unordered items (files changed, findings)
- Keep individual messages concise — the user is monitoring a workflow, not reading a report
- Never use emoji in workflow output
