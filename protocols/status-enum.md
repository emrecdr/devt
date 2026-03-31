# Status Enum Protocol

All devt agents use these status values in their output artifacts:

## Agent Output Status

| Status               | Meaning                                                      | Workflow Action                       |
| -------------------- | ------------------------------------------------------------ | ------------------------------------- |
| `DONE`               | Work completed successfully                                  | Proceed to next step                  |
| `DONE_WITH_CONCERNS` | Completed but has flagged issues                             | Proceed, but surface concerns to user |
| `BLOCKED`            | Cannot complete — needs user input or architectural decision | STOP workflow, surface to user        |
| `NEEDS_CONTEXT`      | Missing information needed to proceed                        | Ask user, then re-dispatch agent      |

## Review Verdict (code-reviewer only)

| Verdict               | Score | Meaning                                |
| --------------------- | ----- | -------------------------------------- |
| `APPROVED`            | >= 90 | No significant issues                  |
| `APPROVED_WITH_NOTES` | 80-89 | Minor issues noted but acceptable      |
| `NEEDS_WORK`          | < 80  | Issues must be fixed before proceeding |

## Verification Status (verifier only)

| Status       | Meaning                               |
| ------------ | ------------------------------------- |
| `VERIFIED`   | Implementation achieves the task goal |
| `GAPS_FOUND` | Some requirements not met — list gaps |
| `FAILED`     | Implementation does not achieve goal  |

## Debug Status (debugger only)

| Status                     | Meaning                                              |
| -------------------------- | ---------------------------------------------------- |
| `FIXED`                    | Bug identified and fixed                             |
| `NEEDS_MORE_INVESTIGATION` | Partial findings, needs another round                |
| `DONE_WITH_CONCERNS`       | Hit 3-attempt limit — partial fix, needs manual work |
| `BLOCKED`                  | Likely architectural — needs user decision            |

## Workflow Phase Status (workflow state tracking)

| Status          | Meaning                                                    |
| --------------- | ---------------------------------------------------------- |
| `IN_PROGRESS`   | Phase is currently executing                               |
| `DONE`          | Phase completed successfully                               |
| `REVERTED`      | Simplify phase changes were rolled back (quality gates failed after fix attempt) |

Every .devt/state/ artifact MUST include a Status field as the first line after the title.

## Status Transition Mapping

How agent-specific statuses map to workflow actions:

### Code Review → Workflow (Repair Operator)

When review returns `NEEDS_WORK`, the workflow applies an escalating **repair operator**:

| Iteration | Repair Action | Behavior |
| --------- | ------------- | -------- |
| 1         | `RETRY`       | Re-dispatch programmer with full review feedback — address all findings |
| 2         | `DECOMPOSE`   | Classify findings: fix isolated issues, defer cross-cutting ones to scratchpad |
| 3         | `PRUNE`       | Stop iterating — defer remaining findings, proceed with DONE_WITH_CONCERNS |

| Review Verdict        | Workflow Action                                                       |
| --------------------- | --------------------------------------------------------------------- |
| `APPROVED`            | Proceed to next phase (verify/docs/retro)                             |
| `APPROVED_WITH_NOTES` | Proceed to next phase, surface notes to user                          |
| `NEEDS_WORK`          | Apply repair operator (RETRY → DECOMPOSE → PRUNE)                    |

### Verification → Workflow (Repair Operator)

| Verify Iteration | Repair Action | Behavior |
| ---------------- | ------------- | -------- |
| 0                | `RETRY`       | Re-dispatch programmer with gap list |
| 1                | `PRUNE`       | Defer remaining gaps to scratchpad, proceed with DONE_WITH_CONCERNS |

| Verifier Status | Iteration 0                                          | Iteration 1                             |
| --------------- | ---------------------------------------------------- | --------------------------------------- |
| `VERIFIED`      | Proceed to docs/retro                                | Proceed to docs/retro                   |
| `GAPS_FOUND`    | RETRY — re-dispatch programmer with gap list         | PRUNE — defer gaps, proceed with concerns |
| `FAILED`        | Re-dispatch programmer with failure details           | STOP workflow, surface to user           |

### Debug → Workflow

| Debug Status                | Workflow Action                                              |
| --------------------------- | ------------------------------------------------------------ |
| `FIXED`                     | Run quality gates to verify fix, then DONE                   |
| `NEEDS_MORE_INVESTIGATION`  | Re-dispatch debugger with accumulated context (max 3 rounds) |
| `BLOCKED`                   | Surface to user with findings so far                         |

### General Agent → Workflow

| Agent Status         | Workflow Action                          |
| -------------------- | ---------------------------------------- |
| `DONE`               | Proceed to next phase                    |
| `DONE_WITH_CONCERNS` | Proceed, surface concerns to user        |
| `BLOCKED`            | STOP workflow, await user decision       |
| `NEEDS_CONTEXT`      | Ask user for missing info, re-dispatch   |
