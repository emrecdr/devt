# Next — Auto-Advance to Next Logical Step

Read workflow state and execute the next logical action automatically.

---

<purpose>
The user should never need to remember which command comes next. `/devt:next` reads the current
state of the project and workflow, determines what should happen, and does it.
</purpose>

<prerequisites>
- `${CLAUDE_PLUGIN_ROOT}` is set (devt plugin is loaded)
- `node` is available on PATH
</prerequisites>

<available_agent_types>
This workflow may delegate to any devt command/workflow based on detected state. It does not dispatch subagents directly.
</available_agent_types>

<agent_skill_injection>
Not applicable — this workflow routes to other workflows which handle their own skill injection.
</agent_skill_injection>

---

## Steps

<step name="detect_state" gate="current state is understood">
## Step 1: Read State

Gather all available context:

```bash
# Workflow state
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state read 2>/dev/null || echo '{"active": false}'

# Available artifacts
ls .devt/state/*.md .devt/state/*.yaml .devt/state/*.json 2>/dev/null || echo "NO_ARTIFACTS"

# Handoff from pause
cat .devt/state/handoff.json 2>/dev/null || echo "NO_HANDOFF"

# Git status
git status --porcelain 2>/dev/null | head -5
git log --oneline -3 2>/dev/null
```

Build a picture of where things stand:
- Is there an active workflow? What phase?
- Is there a paused handoff?
- Are there artifacts from prior steps (spec, research, decisions, plan)?
- Are there uncommitted changes?
- What was the last thing that happened?
</step>

<step name="route" gate="next action is determined and executed">
## Step 2: Route to Next Action

Based on detected state, execute the appropriate action:

### No workflow, no artifacts
```
Nothing in progress. What would you like to do?
```
Ask via AskUserQuestion:
- "Build something" → ask for task description, then run `/devt:workflow`
- "Define a feature" → ask for feature idea, then run `/devt:specify`
- "Fix a bug" → ask for bug description, then run `/devt:debug`

### No workflow, has stopped_phase (interrupted session)
Read `stopped_phase` and `workflow_type` from state. Route to the correct workflow:

| `workflow_type` | Resume command |
|-----------------|----------------|
| `dev` | `/devt:workflow` with the original task |
| `quick_implement` | `/devt:implement` with the original task |
| `debug` | `/devt:debug` with accumulated context from `.devt/state/debug-context.md` |
| `retro` | `/devt:retro` |
| `arch_health_scan` | `/devt:arch-health` |
| `code_review` | `/devt:review` |
| `research` | `/devt:research` with the original task |
| `plan` | `/devt:plan` with the original task |
| `specify` | `/devt:specify` with the original task |
| `clarify` | `/devt:clarify` with the original task |
| missing/unknown | Ask the user which workflow to resume |

```
Previous session stopped at phase: {stopped_phase}.
Resuming {workflow_type} workflow...
```

### No workflow, has handoff.json (paused)
Read handoff for task, phase, and next_action.
```
Resuming paused workflow: {task}
Last phase: {phase}
Next action: {next_action}
```
Delete handoff.json after reading — it is a one-shot artifact:
```bash
rm -f .devt/state/handoff.json .devt/state/continue-here.md
```
Execute the appropriate workflow based on `workflow_type` from state (default: `/devt:workflow`).

### No workflow, has spec.md but no plan.md
```
Spec exists for: {feature}. Creating implementation plan...
```
Execute `/devt:plan` with the feature description from spec.md.

### No workflow, has plan.md but no impl-summary.md
```
Plan exists for: {task}. Starting implementation...
```
Execute `/devt:workflow` with the task from plan.md (it will pick up the existing plan).

### No workflow, has impl-summary.md and review.md with APPROVED
```
Implementation complete and approved. Ready to ship.
```
Ask: "Create PR now?" → if yes, execute `/devt:ship`.

### Active workflow, phase known
```
Workflow active at phase: {phase} (type: {workflow_type}). Continuing...
```
Route based on `workflow_type`:
- `dev` → Execute `/devt:workflow` to resume from current phase
- `quick_implement` → Execute `/devt:implement` to resume quick pipeline
- `debug` → Execute `/devt:debug` to continue debugging
- `retro` → Execute `/devt:retro` to continue lesson extraction
- `arch_health_scan` → Execute `/devt:arch-health` to continue scan
- `code_review` → Execute `/devt:review` to continue review
- `research` → Execute `/devt:research` to continue investigation
- `plan` → Execute `/devt:plan` to continue planning
- `specify` → Execute `/devt:specify` to continue spec generation
- `clarify` → Execute `/devt:clarify` to continue decision capture
- missing/unknown → Execute `/devt:workflow` (default)

### Active workflow, status BLOCKED
Read the blocking reason from the latest artifact.
```
Workflow blocked at {phase}: {reason}
```
Present the blocker and ask the user how to proceed:
- "Fix it and continue" → user fixes, then re-run `/devt:workflow`
- "Cancel and start over" → execute `/devt:cancel-workflow`
- "Investigate" → execute `/devt:forensics`

### Uncommitted changes, no workflow
```
Found uncommitted changes ({N} files). Ship them?
```
Ask: "Create PR?" → if yes, execute `/devt:ship`.

### Nothing detected
```
Clean slate. Use /devt:workflow to start building.
```
</step>

---

<deviation_rules>
1. **READ-ONLY detection**: The state detection step must NOT modify any files.
2. **Ambiguous state**: If multiple interpretations are possible, ask the user rather than guessing.
3. **Stale state**: If state file exists but artifacts are missing, suggest `/devt:cancel-workflow` to reset.
</deviation_rules>

<success_criteria>
- State correctly detected from available sources
- Next action identified and either executed or presented to user
- No incorrect assumptions about workflow state
</success_criteria>
