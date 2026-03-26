# Status Enum Protocol

All devt agents use these status values in their output artifacts:

## Agent Output Status

| Status | Meaning | Workflow Action |
|--------|---------|----------------|
| `DONE` | Work completed successfully | Proceed to next step |
| `DONE_WITH_CONCERNS` | Completed but has flagged issues | Proceed, but surface concerns to user |
| `BLOCKED` | Cannot complete — needs user input or architectural decision | STOP workflow, surface to user |
| `NEEDS_CONTEXT` | Missing information needed to proceed | Ask user, then re-dispatch agent |

## Review Verdict (code-reviewer only)

| Verdict | Score | Meaning |
|---------|-------|---------|
| `APPROVED` | >= 90 | No significant issues |
| `APPROVED_WITH_NOTES` | 80-89 | Minor issues noted but acceptable |
| `NEEDS_WORK` | < 80 | Issues must be fixed before proceeding |

## Verification Status (verifier only)

| Status | Meaning |
|--------|---------|
| `VERIFIED` | Implementation achieves the task goal |
| `GAPS_FOUND` | Some requirements not met — list gaps |
| `FAILED` | Implementation does not achieve goal |

## Debug Status (debugger only)

| Status | Meaning |
|--------|---------|
| `FIXED` | Bug identified and fixed |
| `NEEDS_MORE_INVESTIGATION` | Partial findings, needs another round |
| `BLOCKED` | Likely architectural — needs user decision |

Every .devt-state/ artifact MUST include a Status field as the first line after the title.
