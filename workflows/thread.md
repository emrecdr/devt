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

- `/devt:thread create <title>` → create a new thread (session handoff)
- `/devt:thread list` → show all threads with status
- `/devt:thread resume <N|slug>` → load a thread into the current session (N = list index; slug = filename stem — the slug form is what handoff prompts emit, stable across sessions)
- `/devt:thread update <N|slug>` → refresh an open thread from the current session
</step>

<step name="create">
## Create Thread (session handoff)

1. Create `.devt/state/threads/` if it doesn't exist
2. Generate slug from title. **Never overwrite an existing thread**: if `threads/{slug}.md` already exists (another session may own it), suffix the slug with `-HHMM` from the current time and use that — every handoff file is uniquely named, so concurrent sessions cannot clobber each other
3. **Distill the current session yourself** — Goal, Context (key findings, decisions with their reasons, artifact status), and Next Steps (what is left, as actionable checkboxes) come from the conversation and `.devt/state/` artifacts, NOT from quizzing the user. Ask at most one question, and only when the goal is genuinely ambiguous. Two rules:
   - **Reference, don't duplicate**: point to artifacts (paths, URLs, commit hashes) instead of copying their content into the thread.
   - **Redact secrets**: API keys, tokens, passwords, PII never enter the thread file — name where the value lives instead.
4. Write thread file:

```markdown
---
title: {title}
status: OPEN
session: {workflow_id from .devt/state/workflow.yaml when a workflow is active; otherwise adhoc-YYYYMMDD-HHMM}
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

5. END by printing the copy-paste resume prompt — this is the handoff contract:

   ```
   Thread saved: .devt/state/threads/{slug}.md

   Copy-paste to continue in a new session:

       /devt:thread resume {slug}
   ```
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

<step name="update">
## Update Thread

1. Read the thread file (match by slug, or by list index when numeric)
2. Refresh Context + Next Steps from the current session (same distill + redaction rules as create); bump `updated`
3. Re-print the copy-paste resume prompt from the create step
</step>

<step name="resume">
## Resume Thread

1. Read the thread file (match by slug, or by list index when numeric)
2. Update status to IN_PROGRESS
3. Update `updated` timestamp
4. Present to user:
   - Goal (what you're working on)
   - Context (what you know)
   - Next Steps (what to do now)
5. The session now has full thread context — proceed with the work
6. **One-shot handoffs resolve on resume**: if the thread exists purely to carry a session handoff (created at session end, resumed once), set status RESOLVED now — read once, done. Long-running investigation threads stay IN_PROGRESS instead: update Context and Next Steps before the session ends. RESOLVED thread files are inert and safe to delete at any time.
</step>

</process>

<success_criteria>
- Thread file created/updated with proper frontmatter
- Status transitions: OPEN → IN_PROGRESS → RESOLVED
- Context and Next Steps updated before session ends
</success_criteria>
