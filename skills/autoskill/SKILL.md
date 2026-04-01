---
name: autoskill
description: Detect recurring correction patterns and propose concrete improvements to the devt plugin system — updating skills, agents, .devt/rules/, or workflows. Use when the user has corrected the same behavior multiple times and wants to codify it as a permanent rule or skill update. Trigger on 'improve the plugin', 'add a rule for this', 'we keep making this mistake', 'this should be a skill', 'automate this pattern', 'this should be automated', 'capture this as a system improvement', 'propose a skill update', 'codify this pattern', 'the agent keeps forgetting to X', 'every session has the same problem', 'analyze this session for corrections', 'suggest improvements to the plugin', or when repeated course corrections reveal a skill gap. Also trigger when the user says 'this should be a rule', 'make this permanent', or asks to update how agents behave based on observed patterns. This is about improving the plugin SYSTEM (rules, skills, agents, workflows) — NOT about recording lessons to the learning playbook (use lesson-extraction for that) and NOT about pruning/archiving playbook entries (use memory-compaction for that).
---

# Autoskill

## Overview

The devt plugin improves through use. When sessions reveal repeated corrections, recurring patterns, or gaps in agent capabilities, these signals should be captured as concrete proposals for system updates.

Autoskill does not make changes directly. It detects signals and proposes changes with evidence. The user decides what to implement.

## When NOT to Use

Skip for one-off fixes, debugging sessions, or tasks that don't reveal reusable patterns. If the session was a straightforward bug fix with no corrections or novel techniques, there is nothing for autoskill to capture.

## Time Budget

Analysis: **1-2 minutes**. Proposal generation: **1-3 minutes**.

## The Iron Law

```
NO PROPOSALS WITHOUT 3+ CONFIDENCE POINTS
```

Proposals require scored evidence, not guesswork. A single explicit correction with "always/never" (5 points) is sufficient. Three weak approvals (3 points) barely qualify. Without scored evidence, the plugin accumulates speculative rules that constrain more than they help.

The scoring system prevents both extremes: ignoring a strong single correction because it's "only one instance", and acting on three vague approvals that don't form a real pattern.

## The Process

### Step 1: Detect Signals

Review the session for these signal types:

#### Repeated Corrections

The user corrected the same behavior 2+ times in a session, or the same correction appears across multiple sessions.

**Examples**: "Don't commit without asking", "Always check for duplicates first"

#### New Patterns

A technique or approach was used successfully but is not documented in any skill or agent file.

**Examples**: A new testing pattern, a deployment workflow, a debugging technique

#### Missing Capabilities

An agent lacked information or tools to complete a task without user intervention.

**Examples**: Agent did not know about a project convention, agent could not find a configuration value, agent used wrong API

#### Workflow Gaps

A step in a workflow required manual intervention that could be automated or codified.

**Examples**: Manual file lookup that could be in context loading, manual score calculation that could follow a rubric

### Step 2: Score Confidence

Assign a confidence score to each signal:

| Signal Type | Points | Example |
|---|---|---|
| Explicit correction with "always/never" | 5 | "Never commit without asking" |
| Repeated pattern (2+ occurrences) | 3 | Same feedback given twice in different contexts |
| Single correction | 2 | "Use X instead of Y" |
| Approval / confirmation | 1 | "Yes, keep doing it this way" |

Sum the points per proposal. Only propose changes that score 3+ points total (replaces the hard "3 instances" rule with nuanced scoring — a single explicit "always do X" correction at 5 points is sufficient, while three weak approvals at 3 points barely qualify).

### Step 3: Filter for New Information

Before proposing, ask: is this something the agent would already know without being told?

**Worth capturing** (project-specific knowledge):
- Project conventions that differ from defaults
- Custom utility/component locations
- Team preferences
- Domain-specific terminology
- Non-obvious architectural decisions
- Integration quirks specific to this stack

**NOT worth capturing** (common knowledge):
- General best practices (DRY, separation of concerns)
- Language/framework conventions
- Standard library usage
- Universal security practices
- Common accessibility guidelines

If the same advice would apply to any project, it does not belong in a skill or `.devt/rules/`.

### Step 4: Route to Correct Target

Each signal belongs in one of two places:

**Update a skill** (`skills/<name>/SKILL.md`) when:
- Signal relates to how a specific skill should behave
- Preference affects skill trigger conditions or outputs
- Pattern is about a skill's decision-making process

**Update project rules** (`.devt/rules/` or `CLAUDE.md`) when:
- Signal describes project-wide conventions (naming, structure, architecture)
- Tool/library preferences that span multiple skills
- Team style preferences
- Domain-specific terminology used across the codebase

**Examples**:
- "Don't add try-catch for internal functions" → skill (how code-reviewer or programmer should behave)
- "We use UUIDv7 for all entity IDs" → `.devt/rules/coding-standards.md` (project convention)
- "Auth logic lives in middleware, not handlers" → `.devt/rules/architecture.md` (architecture decision)

### Step 5: Draft Proposal

Structure each proposal as:

```yaml
type: skill_update | agent_update | dev_rules_update | workflow_update
target: skills/codebase-scan/SKILL.md  # or .devt/rules/coding-standards.md, agents/programmer.md
confidence: HIGH (7+) | MEDIUM (3-6)
score: N points
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

#### Example: Accepted Proposal (score 5+)

```yaml
type: dev_rules_update
target: .devt/rules/coding-standards.md
confidence: HIGH
score: 5 points
change: |
  Add rule: "Never use default exports in TypeScript files — always use named exports."
reasoning: |
  User gave explicit "always/never" correction: "Never use default exports."
evidence:
  - "Session 12: user corrected 'use named exports, never default' (5 pts — explicit always/never)"
```

#### Example: Rejected Proposal (score below threshold)

```yaml
type: skill_update
target: skills/code-review-guide/SKILL.md
confidence: REJECTED
score: 2 points  # Below 3-point threshold — do not propose
change: |
  Add guidance: "Prefer early returns over nested if-else chains."
reasoning: |
  Single correction without "always/never" language. This is also a general
  best practice, not project-specific knowledge. Fails both the score threshold
  and the "new information" filter.
evidence:
  - "Session 8: user said 'use an early return here' (2 pts — single correction)"
# VERDICT: Do not propose. Wait for more evidence or stronger signal.
```

### Step 6: Validate Proposal

Before presenting, verify:

- The change does not contradict existing skills or rules
- The change is not already covered by an existing skill or `.devt/rules/` file (search first)
- The evidence is from actual sessions, not hypothetical scenarios
- The change is specific enough to implement without ambiguity

When signals are ambiguous or contradictory, ask the user via AskUserQuestion rather than guessing. Downgrade to MEDIUM confidence and present the ambiguity.

### Step 7: Present to User

Present proposals grouped by confidence:

```
## Autoskill Summary

Detected [N] durable preferences from this session.

### HIGH confidence (score 7+, recommended to apply)
- [change 1] — Score: X points — Target: [file]
- [change 2] — Score: X points — Target: [file]

### MEDIUM confidence (score 3-6, review carefully)
- [change 3] — Score: X points — Target: [file]

Apply high confidence changes? [y/n/selective]
```

Present `.devt/rules/` changes before skill changes (project context first). Wait for explicit approval before editing any file. Never implement proposals without approval.

## Gate Functions

### Gate: Sufficient Evidence

- [ ] Each proposal scores 3+ confidence points
- [ ] Evidence is from actual sessions (not hypothetical)
- [ ] Signal passes the "new information" filter (project-specific, not common knowledge)

### Gate: No Contradictions

- [ ] Proposed change does not conflict with existing skills
- [ ] Proposed change does not duplicate existing coverage
- [ ] Proposed change is consistent with the plugin's design principles

### Gate: Actionable Proposal

- [ ] Change is specific enough to implement directly
- [ ] Target file identified
- [ ] Exact content change described

## Anti-patterns

| Anti-pattern | Why it fails | Instead |
| --- | --- | --- |
| "This seems like it might be useful" | Intuition without evidence produces noise | Show 3 concrete instances |
| "Let's add this rule just in case" | Rules without evidence are noise that slows agents | Prove the need with repeated occurrences |
| "The agent should know everything" | More context is not better context | Add only what solves real problems |
| "This happened once, let's codify it" | Once is an incident, not a pattern | Wait for 3 occurrences before proposing |
| "One strong example is enough" | One example could be an outlier | Patterns require repetition across sessions |
| "This is obviously needed" | If it were obvious, it would already exist | Prove the need with evidence |
| "More rules make agents better" | More rules make agents slower | Only add what solves real, recurring problems |
| "We should be proactive" | Proactive without evidence is speculative | Be reactive to observed patterns |

## Change Constraints

- Never delete existing rules without explicit user instruction
- Prefer additive changes over rewrites
- One concept per change — easy to review and revert independently
- Preserve existing file structure and tone
- Commit each change separately when git is available: `chore(autoskill): [brief description]`

## Integration

- **Prerequisites**: Completed sessions with observable patterns
- **Feeds into**: Skill files (agent behavior), `.devt/rules/` (project conventions), agent files, workflow files
- **Used by agents**: retro (post-session analysis), curator (playbook-to-skill promotion)
- **Related skills**: lesson-extraction (captures lessons; autoskill captures system improvements)
