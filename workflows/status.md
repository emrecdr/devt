# Status — Workflow Progress Check

Show where the current workflow stands and what comes next.

---

<prerequisites>
- `${CLAUDE_PLUGIN_ROOT}` is set (devt plugin is loaded)
- `node` is available on PATH
</prerequisites>

<available_agent_types>
This workflow does NOT use subagents. All steps are executed by the main session.
</available_agent_types>

<agent_skill_injection>
Not applicable — this workflow does not dispatch subagents.
</agent_skill_injection>

---

## Steps

<step name="read_state" gate="workflow state is read">

## Read Current State

Read the workflow state:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state read
```

Also check for `.devt/state/` directory and list available artifacts:

```bash
ls -la .devt/state/ 2>/dev/null || echo "NO_ARTIFACTS"
```

Check for stopped_at in workflow context:

```bash
cat .devt/state/workflow.yaml 2>/dev/null || echo "NO_CONTEXT"
```

Check for structured handoff from /devt:pause:

```bash
cat .devt/state/handoff.json 2>/dev/null || echo "NO_HANDOFF"
```

If `.devt/state/handoff.json` exists:
Read it for rich context.
Show: task, phase, progress summary, next action, context notes.
Also read `.devt/state/continue-here.md` if it exists for human-readable summary.

</step>

<step name="report" gate="status is reported to user">

## Report Status

### If no active workflow:

Report:

```
No active workflow.

Use /devt:workflow or /devt:implement to start a new task.
Use /devt:fast for trivial changes (3 or fewer files).
```

If stopped_at exists from a previous session:

```
Previous session stopped at: {stopped_at}
Resume with /devt:workflow or start fresh with /devt:cancel-workflow.
```

### If active workflow:

Read available artifacts from `.devt/state/` and compose a progress report:

```
Workflow Status
---
Task:       {task description from state}
Phase:      {current phase}
Iteration:  {iteration count}
Status:     {current status}

Completed Steps:
  {checkmark} context_init
  {checkmark} scan
  {checkmark} implement (DONE, N files changed)
  {arrow}     test (IN PROGRESS)
  {circle}    review
  {circle}    docs

Artifacts:
  {checkmark} .devt/state/scan-results.md
  {checkmark} .devt/state/impl-summary.md
  {circle}    .devt/state/test-summary.md
  {circle}    .devt/state/review.md

Next: {description of what comes next}
```

### Artifact Consistency Check

Run the consistency validator to check for missing artifacts:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state validate
```

If `consistent` is `false`, report each mismatch as a warning:

```
Consistency Issues:
  ⚠ {phase} phase completed but {expected_artifact} is missing
```

This catches cases where a phase transitioned to the next step without writing its expected output (e.g., review returned BLOCKED but the workflow advanced anyway).

If `consistent` is `true` or the workflow is inactive, skip this section silently.

### Additional Context (if available)

**Decisions** (from `.devt/state/decisions.md` or `handoff.json`):
- List key decisions made during the workflow with rationale

**Blockers** (from `handoff.json` if paused):
- Technical blockers with type
- Human actions pending (API keys, approvals, manual testing)

**Active Threads** (from `.devt/state/threads/`):
```bash
ls .devt/state/threads/*.md 2>/dev/null | head -10
```
If threads exist, list them with status (OPEN/IN_PROGRESS/RESOLVED) and last-updated date.

**Deviations** (from `impl-summary.md` if it has a Deviations section):
- List any auto-fixes or deferred items from the current workflow

Use these markers:

- Completed: checkmark symbol
- In progress: arrow symbol
- Pending: circle symbol

Adapt the step list to match the actual workflow type (full workflow has more steps than quick-implement).

</step>

<step name="suggest_next" gate="next action is suggested">

## Suggest Next Action

Based on current state, suggest the appropriate next command:

| State                                    | Suggestion                                                               |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| No workflow, no stopped_at               | "Start with /devt:workflow, /devt:implement, or /devt:fast"              |
| No workflow, has stopped_at              | "Resume with /devt:next or start fresh with /devt:cancel-workflow" (mention the workflow_type if available, e.g., "Interrupted research workflow") |
| Active, phase=scan                       | "Continue with /devt:workflow to proceed to implementation"              |
| Active, phase=implement                  | "Continue with /devt:workflow to proceed to testing"                     |
| Active, phase=test                       | "Continue with /devt:workflow to proceed to simplify/review"             |
| Active, phase=simplify                   | "Continue with /devt:workflow to proceed to review"                      |
| Active, phase=review, verdict=NEEDS_WORK | "Continue with /devt:workflow to iterate on review findings"             |
| Active, phase=verify                     | "Continue with /devt:workflow to proceed to docs"                        |
| Active, phase=docs                       | "Continue with /devt:workflow to proceed to retro"                       |
| Active, phase=retro                      | "Continue with /devt:workflow to finalize"                               |
| Active, phase=curate                     | "Continue with /devt:workflow to finalize"                               |
| Active, phase=autoskill                  | "Continue with /devt:workflow to finalize"                               |
| Active, phase=review_deferred            | "Continue with /devt:workflow to finalize"                               |
| Active, phase=debug                      | "Continue with /devt:debug to resume investigation"                      |
| Active, phase=arch_health_scan           | "Continue with /devt:arch-health to resume scan"                         |
| Active, workflow_type=quick_implement    | "Continue with /devt:implement to resume quick pipeline"                 |
| Active, workflow_type=research           | "Continue with /devt:research to resume investigation"                   |
| Active, workflow_type=plan               | "Continue with /devt:plan to resume planning"                            |
| Active, workflow_type=specify            | "Continue with /devt:specify to resume spec generation"                  |
| Active, workflow_type=clarify            | "Continue with /devt:clarify to resume decision capture"                 |
| Active, phase=complete                   | "Workflow is done. Use /devt:ship to create a PR"                        |
| Active, status=BLOCKED                   | "Resolve the blocker described above, then continue with /devt:workflow" |

</step>

---

<deviation_rules>

1. **No state tool**: If `devt-tools.cjs state read` fails, fall back to reading `.devt/state/` artifacts directly and inferring state from which files exist.
2. **Partial state**: If some state fields are missing, report what is available and mark the rest as "unknown".
3. **Stale state**: If the state file exists but `.devt/state/` is empty, report: "State file exists but no artifacts found. The workflow may be stale. Consider /devt:cancel-workflow."
   </deviation_rules>

<success_criteria>

- Workflow state is read (or absence is detected)
- Progress report is displayed with completed/pending steps and artifacts
- Next action is suggested based on current state
- No files are modified (READ-ONLY operation)
  </success_criteria>
