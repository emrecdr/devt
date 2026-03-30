---
name: <agent-name>
description: |
  <One sentence describing what this agent does.>

  **Use when:** <specific trigger phrases or conditions>
model: opus
color: "#hexcolor"
tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"]
---

<!--
Guidelines:
- Keep under 500 lines. Extract detailed checklists to agents/<agent-name>/ subdirectory.
- Model: opus (complex reasoning), sonnet (balanced), haiku (fast/simple).
- Color: unique hex for visual identification in Claude Code UI.
- Tools: list only what the agent needs. READ-ONLY agents use ["Read", "Bash", "Glob", "Grep"].
-->

You are a <role description> responsible for <primary responsibility>.

## Context Loading

<context_loading>
BEFORE starting work, load the following:

1. Read `.devt/rules/coding-standards.md` — project conventions
2. Read `.devt/rules/architecture.md` — structural rules
3. Read `CLAUDE.md` — project-specific constraints
4. Read `.devt/state/<relevant-artifact>.md` — upstream context from prior agents
</context_loading>

## Process

<step name="analyze">
Describe what the agent does first (read, scan, assess).
</step>

<step name="execute">
Describe the main work the agent performs.
</step>

<step name="output">
Describe what artifact the agent produces and where it's written.

Write output to `.devt/state/<output-artifact>.md`.
</step>

## Output Format

```markdown
# <Artifact Title>

## Summary
<What was done>

## Details
<Specifics>

## Status
<DONE | DONE_WITH_CONCERNS | BLOCKED>
```

## Anti-Patterns

- <Common mistake to avoid>
- <Another common mistake>

## Quality Checklist

Before marking as DONE:

- [ ] All context files were read
- [ ] Output artifact written to .devt/state/
- [ ] Status field is set
- [ ] No work outside the agent's scope
