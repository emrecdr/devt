---
name: scratchpad
description: Use when an agent needs to record decisions, observations, or errors during a multi-step workflow. Persists notes across agent handoffs in .devt/state/scratchpad.md. Trigger whenever making a decision that later steps need, encountering an error that affects downstream work, or discovering something unexpected.
---

# Scratchpad

## Overview

The scratchpad is ephemeral working memory for agents during a single workflow execution. It captures decisions, errors, observations, and intermediate results that later steps may need.

It is append-only during a workflow and reset between workflows.

## The Iron Law

```
WRITE DECISIONS AND OBSERVATIONS WHEN THEY HAPPEN — NOT LATER
```

Multi-agent workflows pass context through artifacts, not shared memory. A decision made during implementation but not written down is invisible to the tester, reviewer, and verifier that follow. Real-time capture also prevents hindsight bias — recording observations as they happen produces more accurate context than reconstructing them later.

A decision not recorded at the moment it is made will be lost, misremembered, or reconstructed incorrectly by the next agent in the workflow.

## The Process

### Step 1: Write to Scratchpad

Append entries to `.devt/state/scratchpad.md` with a timestamp and category:

```markdown
## [HH:MM] Decision

Chose Option B for the repository pattern because...

## [HH:MM] Error

Type checker reported error in service module:45 — incompatible return type...

## [HH:MM] Observation

The existing codebase uses sync sessions everywhere despite async routes...

## [HH:MM] Blocker

Cannot proceed with integration test — database migration missing...
```

### Step 2: Reference in Later Steps

When a later step needs context from an earlier step, read the scratchpad. This is the handoff mechanism between agents in a multi-agent workflow.

### Step 3: Reset Between Workflows

The scratchpad is cleared at the start of each new workflow. Do not rely on scratchpad contents persisting across workflows. Anything that must persist should be captured as a lesson (via lesson-extraction) or committed to a state file.

## Categories

| Category        | When to use                                 |
| --------------- | ------------------------------------------- |
| **Decision**    | A choice was made between alternatives      |
| **Error**       | Something failed and may affect later steps |
| **Observation** | Something noteworthy discovered during work |
| **Blocker**     | Cannot proceed without resolution           |
| **Result**      | Intermediate output needed by a later step  |

## Gate Functions

- **Append-only**: Never edit or delete previous entries during a workflow
- **Timestamped**: Every entry includes the time for ordering
- **Categorized**: Every entry has a category label from the table above
- **Concise**: Capture the essential information, not a full narrative (1-2 lines per entry)
- **Ephemeral**: Do not treat the scratchpad as permanent storage — it resets between workflows

## Anti-patterns

| Anti-pattern | Why it fails | Do Instead |
|-------------|-------------|---------|
| Not writing anything down | Decisions are lost between agent handoffs | Write every decision, even if it seems obvious |
| Writing novels | Long entries waste tokens and are skipped by next agent | Keep entries to 1-2 lines each |
| Overwriting prior entries | Context from earlier steps is lost | Append only — never delete prior entries |
| Using scratchpad as permanent storage | Cleared between workflows — data will be lost | Promote to lessons (lesson-extraction) or commit to state |
| Writing only errors, not decisions | Later agents can't understand WHY choices were made | Record decisions with brief rationale |
| Skipping timestamps | Entries can't be ordered or correlated with other artifacts | Always include [HH:MM] prefix |

## Multi-Agent Handoff Example

When a workflow dispatches multiple agents, the scratchpad serves as cross-agent memory. The programmer writes "Observation: API returns paginated results, need to handle cursor" and the tester reads it to know what edge cases to cover.

## When NOT to Use

Skip for single-step tasks or trivial fixes where there's nothing worth recording.

## Time Budget

- Per entry: seconds
- Reading scratchpad: 30 seconds

## Integration

- **Location**: `.devt/state/scratchpad.md`
- **Used by agents**: All agents during workflow execution
- **Related skills**: lesson-extraction (promotes scratchpad observations to permanent lessons)
