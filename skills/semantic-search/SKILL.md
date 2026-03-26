---
name: semantic-search
description: Use before starting new work to load relevant historical lessons from the learning playbook. Also use when hitting a familiar problem pattern. Trigger on 'have we seen this before', 'check lessons', 'search the playbook', 'this feels familiar', or before implementing anything in a domain where past lessons might apply.
---

# Semantic Search

## Overview

The learning playbook accumulates institutional knowledge across sessions. Semantic search makes that knowledge accessible at the point of need — before implementing, not after failing.

Querying before acting turns past mistakes into present advantages.

## When to Use

- Before starting any new implementation task (check for relevant lessons)
- When encountering an error or unexpected behavior (check if it was seen before)
- When choosing between approaches (check if a similar decision was made before)
- When working in an unfamiliar part of the codebase (check for module-specific lessons)
- When a problem feels familiar but you cannot pinpoint why

## The Process

### Step 1: Formulate Query

Write a natural language query describing what you are looking for:

- Good: "repository pattern cross-service data access"
- Good: "error handling swallowed custom exception returned 500"
- Bad: "how to code" (too broad)
- Bad: "bug" (meaningless without context)

Include domain terms, framework names, and the type of problem.

### Step 2: Run Search

Use the search script:

```bash
python scripts/query.py "your search query"
```

The script uses FTS5 (full-text search) on the playbook database. Results are ranked by relevance and include the full lesson entry with scores.

### Step 3: Evaluate Results

For each result:

- **Check confidence** — Low confidence lessons (< 0.5) are hypotheses, not facts
- **Check decay** — Lessons past their decay date may be stale
- **Check evidence** — Read the evidence field to understand the original context
- **Assess applicability** — Does the lesson apply to your current situation?

### Step 4: Apply or Discard

- **Applicable**: Use the lesson to inform your approach. Reference it in your work.
- **Partially applicable**: Extract the relevant principle, adapt to current context.
- **Not applicable**: Discard. A lesson about Python ORMs may not apply to a NoSQL situation.
- **Contradicts current understanding**: Investigate. Either the lesson is stale or your understanding needs updating.

## Fallback: No Python Available

If the Python scripts are not available or the database does not exist, fall back to text search:

```bash
grep -i "search term" learning-playbook.md
```

This is less precise but still surfaces relevant entries.

## Gate Functions

### Gate: Search Performed

- [ ] Query formulated with domain-specific terms
- [ ] Search executed (script or fallback)
- [ ] Results evaluated for applicability

## Red Flags — STOP

- "I do not need to check — this is new territory" — New territory is exactly when past lessons matter most.
- "The search returned nothing useful" — Reformulate with different terms before concluding.
- "I already know the answer" — Check anyway. Confirmation strengthens confidence; contradiction prevents mistakes.

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "Searching takes too long" | A 10-second search beats a 2-hour debugging session |
| "The playbook is too small to be useful" | Even one relevant lesson justifies the search |
| "I'll search if I get stuck" | Search before starting, not after failing |

## Integration

- **Prerequisites**: A learning playbook must exist (created by lesson-extraction)
- **Scripts**: `scripts/query.py` (FTS5 search), `scripts/sync.py` (sync playbook to DB)
- **Used by agents**: All agents (before starting work)
- **Related skills**: lesson-extraction (populates the playbook), playbook-curation (maintains quality)
