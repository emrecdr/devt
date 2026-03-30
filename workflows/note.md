# Note — Zero-Friction Idea Capture

Capture ideas instantly. Promote to tasks when ready.

<purpose>
When an idea strikes mid-workflow, capture it without context-switching.
Notes live in .devt/state/notes/ and can be promoted to structured tasks later.
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
2. **STOP: scope creep** — If the user starts expanding a note into implementation work, suggest /devt:workflow or /devt:implement instead
</deviation_rules>

<process>

<step name="parse">
## Parse Subcommand

Parse the user's input:
- `/devt:note <text>` → append mode (save the note)
- `/devt:note list` → list mode (show all notes)
- `/devt:note promote <N>` → promote mode (convert note N to a task)

IMPORTANT: `/devt:note list of things to try` saves "list of things to try" — only bare `list` triggers list mode.
</step>

<step name="append">
## Append Mode

1. Create `.devt/state/notes/` if it doesn't exist
2. Generate slug from first 4 meaningful words (lowercase, hyphens)
3. Write note file:

```markdown
---
date: YYYY-MM-DDTHH:MM:SSZ
promoted: false
---

{note text verbatim}
```

4. Confirm: "Note saved: .devt/state/notes/{slug}.md"

No questions. No formatting. Instant capture.
</step>

<step name="list">
## List Mode

Show all notes from .devt/state/notes/:
```
Notes:
  1. [2026-03-27] rate-limiting-approach — "Consider token bucket for API rate limiting..."
  2. [2026-03-27] flaky-test-investigation — "The user endpoint test fails on second run..."
  3. [2026-03-26] refactor-auth-middleware — "Auth middleware has grown too complex..."
```

Dimmed if already promoted. Show last 10 if more than 20 exist.
</step>

<step name="promote">
## Promote Mode

Convert note N to a structured task:
1. Read the note file
2. Generate task with:
   - Title (from note content)
   - Description (the full note text)
   - Priority (ask user: HIGH/MEDIUM/LOW)
   - Suggested command: `/devt:plan` or `/devt:implement`
3. Mark note as `promoted: true`
4. Report: "Note promoted to task. Run /devt:plan or /devt:implement to act on it."
</step>

</process>

<success_criteria>
- Append mode: note file saved to .devt/state/notes/ with correct frontmatter
- List mode: all notes displayed with date, slug, and preview
- Promote mode: note converted to task with priority, marked as promoted
- Zero friction: no unnecessary questions asked during append
</success_criteria>
