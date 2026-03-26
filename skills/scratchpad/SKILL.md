---
name: scratchpad
description: Use when an agent needs to record decisions, observations, or errors during a multi-step workflow. Persists notes across agent handoffs in .devt-state/scratchpad.md. Trigger whenever making a decision that later steps need, encountering an error that affects downstream work, or discovering something unexpected.
---

# Scratchpad

## Overview

The scratchpad is ephemeral working memory for agents during a single workflow execution. It captures decisions, errors, observations, and intermediate results that later steps may need.

It is append-only during a workflow and reset between workflows.

## When to Use

- When making a decision that later steps need to reference
- When encountering an error that affects downstream steps
- When discovering something unexpected that changes the plan
- When intermediate results need to persist across agent handoffs
- When recording context that the final report should include

## The Process

### Step 1: Write to Scratchpad

Append entries to `.devt-state/scratchpad.md` with a timestamp and category:

```markdown
## [HH:MM] Decision
Chose Option B for the repository pattern because...

## [HH:MM] Error
mypy reported type error in service.py:45 — incompatible return type...

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

| Category | When to use |
|----------|-------------|
| **Decision** | A choice was made between alternatives |
| **Error** | Something failed and may affect later steps |
| **Observation** | Something noteworthy discovered during work |
| **Blocker** | Cannot proceed without resolution |
| **Result** | Intermediate output needed by a later step |

## Rules

- **Append-only**: Never edit or delete previous entries during a workflow
- **Timestamped**: Every entry includes the time for ordering
- **Categorized**: Every entry has a category label
- **Concise**: Capture the essential information, not a full narrative
- **Ephemeral**: Do not treat the scratchpad as permanent storage

## Integration

- **Location**: `.devt-state/scratchpad.md`
- **Used by agents**: All agents during workflow execution
- **Related skills**: lesson-extraction (promotes scratchpad observations to permanent lessons)
