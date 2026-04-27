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

<deviation_rules>
<!--
State the agent's lane (READ-ONLY or SCOPED-WRITE) and how out-of-scope discoveries are handled.

READ-ONLY agents (code-reviewer, architect, verifier, retro, researcher pattern):
- "Report, don't fix": findings go in the artifact, never into production code.
- Escalation verdict matches the agent's role: NEEDS_WORK / BLOCKED / FAILED / NEEDS_CONTEXT / DONE_WITH_CONCERNS.

SCOPED-WRITE agents (docs-writer, curator pattern):
- Bounded auto-fix authority: only modify the artifacts/files the agent owns; never touch production code.
- Anything outside scope becomes a recorded finding, not a fix.
-->
This agent is <READ-ONLY | SCOPED-WRITE>. Out-of-scope discoveries become <findings | scoped fixes>; escalate with <verdict> when blocked.
</deviation_rules>

<self_check>
<!--
Before emitting the final artifact, the agent verifies its own work. Each item must be objectively checkable — not "looks good" prose. Cite file:line where applicable.
-->
Before writing the final artifact, verify:

1. <Citation/evidence check — every claim has a real anchor>
2. <Format/schema check — artifact matches required structure>
3. <Status field is one of the valid values for this artifact>
4. <Spec/contract compliance check, if applicable>
</self_check>

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
