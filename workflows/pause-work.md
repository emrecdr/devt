# Pause Work — Structured Context Handoff

Create a machine-readable handoff file that enables rich session resumption.

<purpose>
When pausing work mid-workflow, capture the full context so the next session
can resume with minimal ramp-up time. This goes beyond the stop hook's timestamp —
it captures task-level progress, open decisions, and mental model context.
</purpose>

<prerequisites>
- `${CLAUDE_PLUGIN_ROOT}` is set (devt plugin is loaded)
- `.devt/state/` exists with active workflow artifacts
</prerequisites>

<available_agent_types>
This workflow does NOT use subagents. All steps are executed by the main session.
</available_agent_types>

<agent_skill_injection>
Not applicable — this workflow does not dispatch subagents.
</agent_skill_injection>

<process>

<step name="capture_state">
## Capture Current State

Read .devt/state/ and capture:

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

1. `.devt/state/handoff.json` (machine-readable):

```json
{
  "task": "...",
  "tier": "STANDARD",
  "phase": "implement",
  "iteration": 2,
  "paused_at": "2026-03-26T15:30:00Z",
  "last_commit": "abc1234",
  "artifacts": {
    "scan-results.md": "complete",
    "impl-summary.md": "complete",
    "test-summary.md": "complete",
    "review.md": "needs_work"
  },
  "completed_tasks": [
    {
      "phase": "scan",
      "status": "done",
      "summary": "3 existing patterns found"
    },
    {
      "phase": "implement",
      "status": "done",
      "summary": "2 files modified",
      "commit": "abc1234"
    },
    { "phase": "test", "status": "done", "summary": "8/8 passing" }
  ],
  "remaining_tasks": [
    {
      "phase": "review",
      "status": "needs_work",
      "detail": "3 findings remain"
    },
    { "phase": "verify", "status": "pending" },
    { "phase": "docs", "status": "pending" }
  ],
  "blockers": [],
  "human_actions_pending": [],
  "decisions": [
    {
      "decision": "Used framework-native routing pattern",
      "rationale": "Matches existing conventions"
    }
  ],
  "context_notes": "...",
  "next_action": "Fix 3 review findings, then re-submit for review",
  "open_questions": [],
  "active_files": ["path/to/file1.ext", "path/to/file2.ext"]
}
```

Field reference:

- `last_commit`: Git hash for state reproducibility
- `completed_tasks`: Array with per-task status and commit hash
- `remaining_tasks`: What's left — enables intelligent routing on resume
- `blockers`: Technical blockers with type (`technical | human_action | external`)
- `human_actions_pending`: Actions only a human can take (API keys, approvals, manual testing)
- `decisions`: Decisions made during session with rationale (not just outcomes)

2. `.devt/state/continue-here.md` (human-readable):
   A markdown summary of where things stand and what to do next.

**Lifecycle**: On successful resume, delete `handoff.json` to prevent stale reuse. The handoff is a one-shot artifact.
</step>

</process>

<deviation_rules>

1. **Auto-fix: minor issues** — Fix typos, formatting, and obvious errors in captured context inline
2. **STOP: scope creep** — If the user starts working on the task instead of pausing, remind them to either continue work or pause
3. **STOP: missing state** — If .devt/state/ does not exist or has no artifacts, report that there is nothing to pause and suggest starting a workflow first
   </deviation_rules>

<success_criteria>

- handoff.json written to .devt/state/ with all required fields
- continue-here.md written with human-readable summary
- All in-progress work is captured (decisions, context, next steps)
- No information needed for resumption is lost
  </success_criteria>
