# Incident Runbook

Error response patterns for common workflow failures. When something goes wrong during a workflow, match the failure to a pattern below and follow the prescribed response. Do not improvise error handling — these patterns exist because improvisation during failures makes things worse.

---

## Principle: Capture Before Retrying

Before any retry or recovery action, capture:
1. **What failed** — the exact step, command, or gate
2. **Why it failed** — the error message, output, or root cause
3. **What was attempted** — the action that triggered the failure

Without this information, retries are blind and repeat the same mistake.

---

## Pattern: Quality Gate Failure

**Signal**: A linting, type checking, or test command exits with a non-zero status.

**Response**:
1. Read the FULL error output — do not skim or summarize
2. Identify every distinct failure (there may be multiple)
3. Fix each failure at its root cause
4. Re-run the SAME quality gate command
5. Repeat until clean

**Do NOT**: Skip the gate. Comment out the failing check. Move on and "fix it later." Claim the failure is unrelated to your changes.

---

## Pattern: Code Review Returns NEEDS_WORK

**Signal**: A code-reviewer agent returns a verdict of NEEDS_WORK with specific findings.

**Response**:
1. Read every finding — do not cherry-pick
2. Validate each finding against the actual code (Rule 7: Validate Before Implementing)
3. For each valid finding: implement the fix
4. Re-run quality gates after all fixes
5. Re-submit for review if the workflow calls for it

**Do NOT**: Dismiss findings as "pre-existing." Skip findings labeled "minor." Argue that a finding is "acceptable" without evidence. Filter findings by whether your changes introduced them.

---

## Pattern: Agent BLOCKED

**Signal**: A subagent reports BLOCKED status — it cannot proceed without information or a decision it does not have authority to make.

**Response**:
1. Read the agent's BLOCKED reason
2. Surface the blocker to the user with full context:
   - What the agent was trying to do
   - What information or decision is needed
   - What options exist (if any)
3. Wait for user input
4. Re-dispatch the agent with the missing information

**Do NOT**: Make the decision on the agent's behalf. Guess the answer and proceed. Skip the blocked step. Substitute a different approach without user approval.

---

## Pattern: Agent NEEDS_CONTEXT

**Signal**: A subagent reports that it needs additional files, documentation, or context to complete its task.

**Response**:
1. Identify what context is missing
2. Locate it in the codebase or project documentation
3. Re-dispatch the agent with the additional context included in the prompt

**Do NOT**: Ask the user to provide context that exists in the codebase. Re-dispatch without adding the requested context. Assume the agent can figure it out on a second attempt.

---

## Pattern: Fix Loop Exhausted

**Signal**: A fix-review cycle has run 3 times without reaching a passing state. The same or similar failures keep recurring.

**Response**:
1. Stop the loop — do not attempt a 4th iteration
2. Compile a summary:
   - What was the original task
   - What has been tried (all 3 iterations)
   - What keeps failing and why
   - What the root cause appears to be
3. Escalate to the user with this summary
4. Wait for user direction

**Do NOT**: Keep trying the same approach. Widen the scope to "fix everything." Make architectural changes to work around the failure. Silently lower the passing threshold.

---

## Pattern: State Corruption

**Signal**: Workflow state files in `.devt/state/` are inconsistent, missing, or contain data from a previous workflow run. Agents report unexpected state or the workflow orchestrator cannot determine the current phase.

**Response**:
1. Run `/devt:cancel-workflow` to reset state
2. Verify the state directory is clean
3. Restart the workflow from the beginning

**Do NOT**: Manually edit state files. Attempt to "fix" corrupted state. Continue the workflow hoping the corruption is harmless.

---

## Pattern: Generic / Unrecognized Failure

**Signal**: A failure that does not match any pattern above.

**Response**:
1. Capture the full error output
2. Identify the failing component (which step, which agent, which command)
3. Check if the error is transient (network, timeout) — retry once if so
4. If the error persists, surface it to the user with:
   - The exact error message
   - The step that failed
   - What was being attempted
   - Any hypothesis about the cause

**Do NOT**: Retry indefinitely. Swallow the error and continue. Report "something went wrong" without specifics.
