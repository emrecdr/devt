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

**Stale autonomous_chain cleanup**: If the user did NOT invoke this via `--autonomous` and `autonomous_chain` exists in state, clear it to prevent unintended auto-shipping from a previous autonomous run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update autonomous_chain=null
```
</step>

<dispatcher_contract>
## Dispatch mechanic

Every "Execute `/devt:X`" instruction in this workflow means a Skill tool call —
**not** a prose answer about what `/devt:X` would do. devt slash commands are
addressable as skills with the `devt:` prefix (e.g., `/devt:debug` ↔
`Skill tool: name=devt:debug`). Subcommand routes (e.g., `/devt:memory promote`)
translate to `Skill tool: name=devt:memory, args="promote"`.

**Hard rules — what counts as "executing":**

- ✅ RIGHT: `Skill tool: name=devt:debug, args="<task>"` after stating the routing decision
- ✅ RIGHT: `AskUserQuestion(...)` first when a routing rule explicitly says to ask, then Skill tool with the chosen route
- ❌ WRONG: prose like "Let me look at the bug..." then reading code or grepping
- ❌ WRONG: explaining what `/devt:debug` would do without invoking it
- ❌ WRONG: running diagnostics, lint, or tests instead of dispatching

The routing tree below decides WHICH command. The mechanic above decides HOW
to invoke it. If a routing branch lands on `/devt:X`, your final action of this
turn is the Skill tool call — nothing else. (Auxiliary one-shot bash commands
like `rm -f .devt/state/handoff.json` to consume one-shot artifacts ARE allowed
when the routing block specifies them; they are not "doing the work.")
</dispatcher_contract>

<step name="route" gate="next action is determined and executed">
## Step 2: Route to Next Action

Based on detected state, execute the appropriate action (per the dispatch mechanic above):

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
| `preflight` | `/devt:preflight` with the original task (or just `cat .devt/state/preflight-brief.md` if the Brief is FRESH) |
| `memory_promote` / `memory_reject` | `/devt:memory <subcommand>` (one-shot CLI workflows; usually no resume needed) |
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

### No workflow, has impl-summary.md but no review.md
```
Implementation exists but no review yet. Starting code review...
```
Execute `/devt:review` to review the existing implementation.

### No workflow, has impl-summary.md and review.md with NEEDS_WORK
```
Review found issues. Restarting workflow to address feedback...
```
Execute `/devt:workflow` with the original task — the workflow restarts from context_init and proceeds through to the implement phase, where the programmer reads `.devt/state/review.md` as `<review_feedback>` and addresses the findings. **Do not delete review.md** before invoking.

### No workflow, has impl-summary.md and review.md with APPROVED or APPROVED_WITH_NOTES
```
Implementation complete and approved. Ready to ship.
```
If state has `autonomous_chain=ship`: consume the chain (clear it BEFORE dispatching so a stale value from a prior session cannot re-trigger ship inappropriately), then execute `/devt:ship` directly (no prompt — autonomous pipeline continuation):
```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update autonomous_chain=null
```
Otherwise: Ask "Create PR now?" → if yes, execute `/devt:ship`.

### No workflow, has impl-summary.md and review.md but verdict unreadable
```
Review file exists but verdict is missing or unrecognized (possible interrupted review).
```
Ask: "Re-run the review from scratch, or cancel and start over?" → if re-run, execute `/devt:review`; if cancel, execute `/devt:cancel-workflow`.

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
- `preflight` → Brief at `.devt/state/preflight-brief.md`. If `## Status: FRESH`, just `cat` it; if `## Status: STALE`, re-run `/devt:preflight` with the refined task. (Standalone preflight workflows complete in one shot — usually no resume needed.)
- `research` → Execute `/devt:research` to continue investigation
- `plan` → Execute `/devt:plan` to continue planning
- `specify` → Execute `/devt:specify` to continue spec generation
- `clarify` → Execute `/devt:clarify` to continue decision capture
- missing/unknown → Execute `/devt:workflow` (default)

### Active workflow, validation_status="warned"
If `validation_status` is `warned` in state, a prior phase's artifact has an invalid `## Status` value. Surface this to the user before routing further:
```
Validation flag set: {validation_warnings} consistency warning(s) from a prior phase.
The artifact passed file existence but its status value is not in the allowed enum.
```
Read `.devt/state/workflow.yaml` and the most recent artifact (impl-summary.md, review.md, verification.md, etc.) to identify the offending file. Then ask via AskUserQuestion:
- "Re-run the prior phase" → execute the workflow command for the failing phase (e.g., `/devt:review` if review.md, `/devt:debug` if verification.md flagged)
- "Mark as DONE_WITH_CONCERNS and proceed" → manually fix the artifact's `## Status` line to the canonical concerns variant, then re-run `/devt:next` (the flag clears automatically on the next state update with valid statuses)
- "Investigate" → execute `/devt:forensics` to inspect the artifact

Do NOT silently advance past a `validation_status="warned"` flag — the gate exists to make ambiguity explicit.

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

### Idle, deferred queue has open items (v0.29.0+)
Fetch the top open items in a single call (no separate `count` invocation —
presence is implied by the list being non-empty):

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" deferred list --status=open --limit=4
```

If the array is empty, fall through to "Nothing detected" below.
Otherwise, present via AskUserQuestion (one question, 2-4 options):

```yaml
question: "No active workflow. {N} deferred items waiting. Pick one to work on?"
header: "Deferred queue"
multiSelect: false
options:
  - label: "Start: {DEF-NNN-1 title}"
    description: "Captured {captured_at_relative} by {captured_by}. Tags: {tags}. Context: {context}"
  - label: "Start: {DEF-NNN-2 title}"
    description: "..."
  - label: "Skip — show me everything"
    description: "Run /devt:defer list to see the full queue without starting work."
```

On a "Start: DEF-NNN" pick, run `/devt:workflow "{title from DEF-NNN}"` and on workflow completion, prompt to close DEF-NNN. On "Skip", invoke `/devt:defer list`.

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
