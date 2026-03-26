# Checkpoint Protocol

When an agent needs to pause and wait for user input during execution.

## Checkpoint Types

### 1. Human Verify (most common)
Agent completed work but needs user to confirm before proceeding.
- Code changes that affect user-visible behavior
- API contract changes
- Data model modifications

### 2. Decision Required
Multiple valid options exist and the agent cannot choose.
- Already surfaced via /devt:clarify, but new decisions may emerge during implementation

### 3. Human Action Required (rare)
Agent cannot proceed without user performing an action.
- External service authentication
- Manual deployment step
- Third-party approval

## Checkpoint Format

When hitting a checkpoint, the agent MUST output:

```
## CHECKPOINT: [type]

**Progress:** Task X of Y complete
**Status:** [what's done, what's pending]
**Needs:** [specific thing needed from user]
**Options:** (if Decision type)
  A: [option with trade-offs]
  B: [option with trade-offs]
  Recommendation: [A or B with reasoning]
```

Then STOP and wait. Do not continue past a checkpoint.

## After Checkpoint

When the user responds:
1. Read the user's decision
2. Record it in .devt-state/decisions.md
3. Continue from where you stopped

## Auto-Mode

If the workflow is running in autonomous mode and the checkpoint is type "Human Verify":
- Auto-approve if quality gates pass
- STOP if quality gates fail
