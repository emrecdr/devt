# Session Report

Generate a post-session summary from workflow artifacts and git history.

<purpose>
Captures what was accomplished in the current session for handoffs, team visibility, and personal review.
Reads from observable sources (git log, .devt/state/ artifacts) — never fabricates from memory.
</purpose>

<prerequisites>
- Git is available on PATH and the project is a git repository
- `.devt/state/` may contain workflow artifacts
</prerequisites>

<available_agent_types>
This workflow does NOT use subagents. All steps are executed by the main session.
</available_agent_types>

<agent_skill_injection>
Not applicable.
</agent_skill_injection>

<deviation_rules>
1. **ALL data from git** — Never write commit messages, file names, or contributor info from memory. Git log is the source of truth.
2. **Missing artifacts OK** — If .devt/state/ is empty, produce a git-only report. Do not block.
3. **No token estimates** — Exact token counts require API instrumentation. Report observable metrics only.
</deviation_rules>

---

## Steps

<step name="gather" gate="session data collected">

Collect from available sources:

**Git activity (last 24 hours or since last session):**

```bash
git log --oneline --since="24 hours ago" --no-merges 2>/dev/null || echo "No recent commits"
git diff --stat HEAD~10 HEAD 2>/dev/null | tail -1 || echo "No diff available"
```

**Workflow state (if exists):**

Read `.devt/state/workflow.yaml` for: phase, tier, task, status.

**Workflow artifacts (if exist):**

- `.devt/state/impl-summary.md` — what was implemented
- `.devt/state/test-summary.md` — test results
- `.devt/state/review.md` — review verdict
- `.devt/state/decisions.md` — design decisions

</step>

<step name="generate" gate="report written">

Write `.devt/state/session-report.md`:

```markdown
# Session Report

**Date:** {YYYY-MM-DD}
**Project:** {from .devt/config.json slug or directory name}

---

## Summary

- **Task:** {from workflow state or "Multiple tasks"}
- **Tier:** {from workflow state or "N/A"}
- **Status:** {DONE | IN_PROGRESS | BLOCKED}

## Work Performed

{From impl-summary if available, otherwise from git log}

### Commits
{List of commits from git log --oneline}

### Files Changed
{From git diff --stat}

## Test Results

{From test-summary if available, otherwise "No test data"}

## Review

{From review.md if available — verdict + score, otherwise "No review performed"}

## Decisions

{From decisions.md if available, otherwise "No decisions recorded"}

## Open Items

{Any BLOCKED or DONE_WITH_CONCERNS status from artifacts}
```

</step>

<step name="display" gate="summary shown to user">

Show the user a brief summary:

```
Session Report Generated
════════════════════════
Commits: {N}
Files changed: {N}
Status: {DONE | IN_PROGRESS}
Report: .devt/state/session-report.md
```

</step>

<success_criteria>
- All data from git and artifacts (nothing from memory)
- Report written to .devt/state/session-report.md
- Summary displayed to user
</success_criteria>
