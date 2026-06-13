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

# Stuck-signal — guardrail-deny loop detection in current session
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" stuck check 2>/dev/null || echo '{"stuck": false, "deny_count": 0}'

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

> **PRIORITY GUARDS.** Before evaluating any routing branch below, check both early-exit conditions: `workflow.yaml.validation_status="warned"` (content drift) and `stuck check` reporting `stuck: true` (≥3 deny records in current session). These two override generic branch ordering.
> 1. **Stuck-signal first**: if `stuck check` from Step 1 reports `stuck: true`, jump straight to the **"Active workflow, stuck signal"** branch. The deny chain must be reviewed before any other phase routing — the agent is fighting policy, not progressing.
> 2. **`validation_status="warned"` second**: if the flag is set, jump straight to the **"Active workflow, validation_status='warned'"** branch. The warned-state branch is more specific than the generic "phase known" branch and the generic branch would silently advance past the warning.
>
> The branches below are otherwise ordered presentation-of-options, not strict priority. These two guards are the only exceptions that override ordering.

Based on detected state, execute the appropriate action (per the dispatch mechanic above):

### No workflow, no artifacts
```
Nothing in progress. What would you like to do?
```

Before asking the user, check the memory-candidate surface (B-III.1.b). When `_suggestions.md` has ≥ `memory.candidates_surface_threshold` proposals AND the cooldown has elapsed, surface the count so the user sees the pending triage opportunity, and include a "Triage memory candidates" option in the AskUserQuestion. The CLI handles all gating — the workflow just consumes `ready_to_surface`.

```bash
CC_STATUS=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" memory candidates-status 2>/dev/null || echo '{"ready_to_surface":false,"count":0}')
CC_READY=$(echo "$CC_STATUS" | jq -r '.ready_to_surface')
CC_COUNT=$(echo "$CC_STATUS" | jq -r '.count')
if [ "$CC_READY" = "true" ]; then
  echo "💭 ${CC_COUNT} memory candidates pending in .devt/memory/_suggestions.md."
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" memory candidates-touch-surface >/dev/null 2>&1 || true
fi
```

Ask via AskUserQuestion:
- "Build something" → ask for task description, then run `/devt:workflow`
- "Define a feature" → ask for feature idea, then run `/devt:specify`
- "Fix a bug" → ask for bug description, then run `/devt:debug`
- When `CC_READY=true`, also include: "Triage memory candidates (${CC_COUNT} pending)" → run `/devt:memory promote`

### No workflow, has stopped_phase (interrupted session)
Read `stopped_phase` and `workflow_type` from state. Route to the correct workflow:

| `workflow_type` | Resume command |
|-----------------|----------------|
| `dev` | `/devt:workflow` with the original task |
| `quick_implement` | `/devt:implement` with the original task |
| `debug` | `/devt:debug` with accumulated context from `.devt/state/debug-context.md` |
| `retro` | `/devt:workflow --retro` (direct-form `/devt:retro` continues to work) |
| `arch_health_scan` | `/devt:review --focus=arch` (direct-form `/devt:arch-health` continues to work) |
| `code_review` | `/devt:review` |
| `code_review_parallel` | `/devt:review` with the original scope |
| `research` | `/devt:research` with the original task |
| `plan` | `/devt:plan` with the original task |
| `specify` | `/devt:specify` with the original task |
| `clarify` | `/devt:workflow --mode=clarify` with the original task (direct-form `/devt:clarify` continues to work) |
| `preflight` | `/devt:preflight` with the original task (or just `cat .devt/state/preflight-brief.md` if the Brief is FRESH) |
| `memory_promote` / `memory_reject` | `/devt:memory <subcommand>` (one-shot CLI workflows; usually no resume needed) |
| `docs` | `/devt:workflow --mode=docs` (one-shot standalone docs refresh; direct-form `/devt:docs` continues to work) |
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

#### When review.md exists, read the verdict from review.json (single source of truth):

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state read-sidecar review.json
```

Route on the sidecar's `verdict` field. The three branches below are mutually exclusive.

### No workflow, review.json verdict=NEEDS_WORK
```
Review found issues. Restarting workflow to address feedback...
```
Execute `/devt:workflow` with the original task — the workflow restarts from context_init and proceeds through to the implement phase, where the programmer reads `.devt/state/review.md` as `<review_feedback>` and addresses the findings. **Do not delete review.md or review.json** before invoking.

### No workflow, review.json verdict=APPROVED or APPROVED_WITH_NOTES
```
Implementation complete and approved. Ready to ship.
```
If state has `autonomous_chain=ship`: consume the chain (clear it BEFORE dispatching so a stale value from a prior session cannot re-trigger ship inappropriately), then execute `/devt:ship` directly (no prompt — autonomous pipeline continuation):
```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update autonomous_chain=null
```
Otherwise: Ask "Create PR now?" → if yes, execute `/devt:ship`.

### No workflow, review.md exists but review.json missing or verdict unreadable
```
Review file exists but sidecar is missing or unrecognized (possible interrupted review).
```
`read-sidecar` returns `{ok: false}` when the file is missing or invalid. Ask: "Re-run the review from scratch, or cancel and start over?" → if re-run, execute `/devt:review`; if cancel, execute `/devt:workflow --cancel`.

### Active workflow, phase known
```
Workflow active at phase: {phase} (type: {workflow_type}). Continuing...
```
Route based on `workflow_type`:
- `dev` → Execute `/devt:workflow` to resume from current phase
- `quick_implement` → Execute `/devt:implement` to resume quick pipeline
- `debug` → Execute `/devt:debug` to continue debugging
- `retro` → Execute `/devt:workflow --retro` to continue lesson extraction (direct-form `/devt:retro` continues to work)
- `arch_health_scan` → Execute `/devt:review --focus=arch` to continue scan (direct-form `/devt:arch-health` continues to work)
- `code_review` → Execute `/devt:review` to continue review
- `preflight` → Brief at `.devt/state/preflight-brief.md`. If `## Status: FRESH`, just `cat` it; if `## Status: STALE`, re-run `/devt:preflight` with the refined task. (Standalone preflight workflows complete in one shot — usually no resume needed.)
- `research` → Execute `/devt:research` to continue investigation
- `plan` → Execute `/devt:plan` to continue planning
- `specify` → Execute `/devt:specify` to continue spec generation
- `clarify` → Execute `/devt:workflow --mode=clarify` to continue decision capture (direct-form `/devt:clarify` continues to work)
- missing/unknown → Execute `/devt:workflow` (default)

### Active workflow, stuck signal
If `stuck check` reports `stuck: true`, the agent has hit ≥3 deny records in the current workflow session (combined across `preflight`, `bash_destroy`, and `no_verify` sources). Surface the deny chain BEFORE any other routing:

```
Stuck signal: {deny_count} guardrail denies in current session
  {sources_breakdown}
Recent denies:
  {ts}  {source}  {reason}
  {ts}  {source}  {reason}
  ...
```

Walk the user through the chain (top 5 records from `denies[]`). Then ask via AskUserQuestion:
- "Review the offending pattern in `.devt/state/preflight-denies.jsonl`" → present the full deny chain; the user decides whether to adjust the agent's plan, narrow the destructive command's scope, or grant the `--no-verify` flag.
- "Cancel and start over" → execute `/devt:workflow --cancel` (clears the workflow but the deny log persists thanks to RESET_EXEMPT, so the user can still review post-cancel).
- "Continue anyway (acknowledge the chain)" → the user has read the chain and accepts the pattern; route to the generic phase-known branch below. The signal will re-trigger if more denies accumulate.

Do NOT silently advance past a stuck signal — the gate exists so guardrail loops surface to the user rather than burn iterations.

### Active workflow, validation_status="warned"
If `validation_status` is `warned` in state, a prior phase's artifact has an invalid `## Status` value. Surface this to the user before routing further:
```
Validation flag set: {validation_warnings} consistency warning(s) from a prior phase.
The artifact passed file existence but its status value is not in the allowed enum.
```
Read `.devt/state/workflow.yaml` and the most recent artifact (impl-summary.md, review.md, verification.md, etc.) to identify the offending file. Then ask via AskUserQuestion:
- "Re-run the prior phase" → execute the workflow command for the failing phase (e.g., `/devt:review` if review.md, `/devt:debug` if verification.md flagged)
- "Mark as DONE_WITH_CONCERNS and proceed" → manually fix the artifact's `## Status` line to the canonical concerns variant, then re-run `/devt:next` (the flag clears automatically on the next state update with valid statuses)
- "Investigate" → execute `/devt:debug --mode=forensics` to inspect the artifact

Do NOT silently advance past a `validation_status="warned"` flag — the gate exists to make ambiguity explicit.

### Active workflow, status BLOCKED
Read the blocking reason from the latest artifact.
```
Workflow blocked at {phase}: {reason}
```
Present the blocker and ask the user how to proceed:
- "Fix it and continue" → user fixes, then re-run `/devt:workflow`
- "Cancel and start over" → execute `/devt:workflow --cancel`
- "Investigate" → execute `/devt:debug --mode=forensics`

### Uncommitted changes, no workflow
```
Found uncommitted changes ({N} files). Ship them?
```
Ask: "Create PR?" → if yes, execute `/devt:ship`.

### Idle, deferred queue has open items
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
    description: "Run /devt:note --defer list to see the full queue without starting work."
```

On a "Start: DEF-NNN" pick, run `/devt:workflow "{title from DEF-NNN}"` and on workflow completion, prompt to close DEF-NNN. On "Skip", invoke `/devt:note --defer list`.

### Nothing detected
```
Clean slate. Use /devt:workflow to start building.
```
</step>

---

<deviation_rules>
1. **READ-ONLY detection**: The state detection step must NOT modify any files.
2. **Ambiguous state**: If multiple interpretations are possible, ask the user rather than guessing.
3. **Stale state**: If state file exists but artifacts are missing, suggest `/devt:workflow --cancel` to reset (direct-form `/devt:cancel-workflow` continues to work).
</deviation_rules>

<success_criteria>
- State correctly detected from available sources
- Next action identified and either executed or presented to user
- No incorrect assumptions about workflow state
</success_criteria>
