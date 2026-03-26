# Pause Work — Structured Context Handoff

Create a machine-readable handoff file that enables rich session resumption.

<purpose>
When pausing work mid-workflow, capture the full context so the next session
can resume with minimal ramp-up time. This goes beyond stop-hook's timestamp —
it captures task-level progress, open decisions, and mental model context.
</purpose>

<process>

<step name="capture_state">
## Capture Current State

Read .devt-state/ and capture:
- Current workflow phase and step
- Iteration count (if in review loop)
- Which artifacts exist and their status
- Task description and complexity tier
</step>

<step name="capture_progress">
## Capture Task Progress

For each workflow step, record:
- completed / in-progress / pending
- Key outcomes (what was built, test results, review verdict)
- Any blockers or concerns
</step>

<step name="capture_context">
## Capture Mental Model

Record context that would otherwise be lost:
- Key decisions made during this session
- Open questions that remain
- What the next step should focus on
- Any concerns or risks discovered
- Files that were being actively worked on
</step>

<step name="write_handoff">
## Write Handoff Files

Write TWO files:

1. `.devt-state/handoff.json` (machine-readable):
```json
{
  "task": "...",
  "tier": "STANDARD",
  "phase": "implement",
  "iteration": 2,
  "paused_at": "2026-03-26T15:30:00Z",
  "artifacts": {
    "scan-results.md": "complete",
    "impl-summary.md": "complete",
    "test-summary.md": "complete",
    "review.md": "needs_work"
  },
  "progress": {
    "scan": "done",
    "implement": "done (iteration 2)",
    "test": "done",
    "review": "needs_work — 3 findings remain",
    "verify": "pending",
    "docs": "pending"
  },
  "context_notes": "...",
  "next_action": "Fix 3 review findings, then re-submit for review",
  "open_questions": [],
  "active_files": ["path/to/file1.py", "path/to/file2.py"]
}
```

2. `.devt-state/continue-here.md` (human-readable):
A markdown summary of where things stand and what to do next.
</step>

</process>
