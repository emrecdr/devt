---
name: autoskill
description: Use when the user asks to improve the plugin, when repeated corrections suggest a skill gap, or at the end of sessions with multiple course corrections. Requires 3+ evidence instances. Also trigger on 'improve the plugin', 'add a rule for this', 'we keep making this mistake', 'this should be a skill', or 'automate this pattern'.
---

# Autoskill

## Overview

The devt plugin improves through use. When sessions reveal repeated corrections, recurring patterns, or gaps in agent capabilities, these signals should be captured as concrete proposals for system updates.

Autoskill does not make changes directly. It detects signals and proposes changes with evidence. The user decides what to implement.

## When to Use

- At the end of a session where the user corrected agent behavior multiple times
- When a pattern emerges that no existing skill covers
- When an agent repeatedly needs information that should be in its context
- When a workflow step is consistently manual but could be automated
- When the user explicitly asks to improve the plugin based on what happened

## The Process

### Step 1: Detect Signals

Review the session for these signal types:

#### Repeated Corrections

The user corrected the same behavior 2+ times in a session, or the same correction appears across multiple sessions.

**Examples**: "Don't commit without asking", "Always check for duplicates first", "Use UUIDv7 not UUID4"

#### New Patterns

A technique or approach was used successfully but is not documented in any skill or agent file.

**Examples**: A new testing pattern, a deployment workflow, a debugging technique

#### Missing Capabilities

An agent lacked information or tools to complete a task without user intervention.

**Examples**: Agent did not know about a project convention, agent could not find a configuration value, agent used wrong API

#### Workflow Gaps

A step in a workflow required manual intervention that could be automated or codified.

**Examples**: Manual file lookup that could be in context loading, manual score calculation that could follow a rubric

### Step 2: Gather Evidence

For each signal, collect at least 3 evidence instances:

- What happened (the specific interaction or event)
- When it happened (which task or step)
- What the ideal behavior would have been

Signals with fewer than 3 instances may be coincidences, not patterns.

### Step 3: Draft Proposal

Structure each proposal as:

```yaml
type: skill_update | agent_update | rule_update | workflow_update
target: skills/codebase-scan/SKILL.md  # or agents/programmer.md, etc.
change: |
  What specifically should change. Include the exact text to add,
  modify, or remove. Be precise enough that someone could implement
  the change without additional context.
reasoning: |
  Why this change is needed. Reference the signal type and evidence.
evidence:
  - "Session X: user corrected agent to check for duplicates before creating"
  - "Session Y: duplicate interface created because scan was skipped"
  - "Session Z: user added this as a rule in CLAUDE.md after repeated issues"
```

### Step 4: Validate Proposal

Before presenting, verify:

- The change does not contradict existing skills or rules
- The change is not already covered by an existing skill (search first)
- The evidence is from actual sessions, not hypothetical scenarios
- The change is specific enough to implement without ambiguity

### Step 5: Present to User

Present all proposals with their evidence. The user decides which to implement. Do not implement proposals without approval.

## Gate Functions

### Gate: Sufficient Evidence

- [ ] Each proposal backed by 3+ evidence instances
- [ ] Evidence is from actual sessions (not hypothetical)
- [ ] Pattern is recurring (not a one-time incident)

### Gate: No Contradictions

- [ ] Proposed change does not conflict with existing skills
- [ ] Proposed change does not duplicate existing coverage
- [ ] Proposed change is consistent with the plugin's design principles

### Gate: Actionable Proposal

- [ ] Change is specific enough to implement directly
- [ ] Target file identified
- [ ] Exact content change described

## Red Flags — STOP

- "This seems like it might be useful" — Evidence, not intuition. Show 3 instances.
- "Let's add this rule just in case" — Rules without evidence are noise.
- "The agent should know everything" — Agents should know what they need. More is not better.
- "This happened once, let's codify it" — Once is an incident. Three times is a pattern.

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "One strong example is enough" | One example could be an outlier. Patterns require repetition. |
| "This is obviously needed" | If it were obvious, it would already exist. Prove the need. |
| "More rules make agents better" | More rules make agents slower. Only add what solves real problems. |
| "We should be proactive" | Proactive without evidence is speculative. Reactive to patterns is responsive. |

## Integration

- **Prerequisites**: Completed sessions with observable patterns
- **Feeds into**: Skill files, agent files, rule files, workflow files
- **Used by agents**: retro (post-session analysis), curator (playbook-to-skill promotion)
- **Related skills**: lesson-extraction (captures lessons; autoskill captures system improvements)
