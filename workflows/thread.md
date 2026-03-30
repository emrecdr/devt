# Thread — Cross-Session Context Persistence

Lightweight context threads that survive session boundaries.

<purpose>
For work that spans multiple sessions but isn't big enough for a full workflow:
investigating a flaky test, researching an approach, tracking a multi-step migration.
Threads capture Goal + Context + Next Steps so any session can pick up instantly.
</purpose>

<prerequisites>
- `${CLAUDE_PLUGIN_ROOT}` is set (devt plugin is loaded)
</prerequisites>

<available_agent_types>
This workflow does NOT use subagents. All steps are executed by the main session.
</available_agent_types>

<agent_skill_injection>
Not applicable — this workflow does not dispatch subagents.
</agent_skill_injection>

<deviation_rules>
1. **Auto-fix: minor issues** — Fix typos, formatting, and obvious errors inline
2. **STOP: scope creep** — If the user starts doing significant work instead of managing threads, suggest /devt:workflow or /devt:implement instead
</deviation_rules>

<process>

<step name="parse">
## Parse Subcommand

- `/devt:thread create <title>` → create a new thread
- `/devt:thread list` → show all threads with status
- `/devt:thread resume <N>` → load thread N into current session
</step>

<step name="create">
## Create Thread

1. Create `.devt/state/threads/` if it doesn't exist
2. Generate slug from title
3. Write thread file:

```markdown
---
title: {title}
status: OPEN
created: YYYY-MM-DDTHH:MM:SSZ
updated: YYYY-MM-DDTHH:MM:SSZ
---

## Goal
{What are you trying to achieve?}

## Context
{What do you know so far? Relevant files, findings, decisions.}

## References
{File paths, URLs, related issues}

## Next Steps
- [ ] {What to do next when resuming}
```

4. Ask user to fill in Goal and Context (via AskUserQuestion or freeform)
5. Confirm: "Thread created: .devt/state/threads/{slug}.md"
</step>

<step name="list">
## List Threads

Show all threads with status:
```
Threads:
  1. [OPEN]        flaky-user-test — "Investigating intermittent 404 on user endpoint"
  2. [IN_PROGRESS]  auth-refactor — "Breaking auth middleware into smaller pieces"
  3. [RESOLVED]     redis-caching — "Evaluated Redis vs in-memory caching"
```
</step>

<step name="resume">
## Resume Thread

1. Read the thread file
2. Update status to IN_PROGRESS
3. Update `updated` timestamp
4. Present to user:
   - Goal (what you're working on)
   - Context (what you know)
   - Next Steps (what to do now)
5. The session now has full thread context — proceed with the work
6. Before session ends, update the thread's Context and Next Steps
</step>

</process>

<success_criteria>
- Thread file created/updated with proper frontmatter
- Status transitions: OPEN → IN_PROGRESS → RESOLVED
- Context and Next Steps updated before session ends
</success_criteria>
