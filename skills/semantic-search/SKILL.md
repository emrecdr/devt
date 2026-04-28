---
name: semantic-search
description: Use to search the learning playbook for past lessons before starting implementation or when a problem feels familiar. Queries the FTS5 database (or grep fallback) for historical insights. Trigger on 'have we seen this before', 'check past lessons', 'search the playbook', 'this feels familiar', 'query lessons', 'check the playbook before implementing', 'search for lessons about X', 'any past lessons on X', 'look up prior experience with X', 'check if we have recorded lessons about X', or whenever an agent is about to work in a domain where past mistakes or solutions may exist. Always use BEFORE implementing, not after failing. This is for READING/QUERYING existing lessons, NOT for adding new lessons (use lesson-extraction), NOT for deduplicating or cleaning up the playbook (use playbook-curation), and NOT for recording ephemeral notes (use scratchpad).
---

# Semantic Search

## Overview

The learning playbook accumulates institutional knowledge across sessions. Semantic search makes that knowledge accessible at the point of need — before implementing, not after failing.

Querying before acting turns past mistakes into present advantages.

## The Iron Law

```
NO IMPLEMENTATION WITHOUT CHECKING THE PLAYBOOK FIRST
```

The playbook contains lessons paid for by past debugging sessions, failed approaches, and user corrections. Skipping the check means repeating mistakes the team already resolved. Even a negative result ("no relevant lessons") takes seconds and confirms the approach is novel rather than a known pitfall.

Past mistakes become present advantages only if you query before acting. A 10-second search beats a 2-hour debugging session on a problem you already solved.

## The Process

### Step 1: Formulate Query

Write a natural language query describing what you are looking for:

- Good: "repository pattern cross-service data access"
- Good: "error handling swallowed custom exception returned 500"
- Bad: "how to code" (too broad)
- Bad: "bug" (meaningless without context)

Include domain terms, framework names, and the type of problem.

### Step 2: Run Search

Use the CLI:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" semantic query "your search query"
```

This uses FTS5 (full-text search) on the playbook database. Results are ranked by relevance and include the full lesson entry with scores. If no database exists, falls back to keyword matching on .devt/learning-playbook.md.

FTS5 default semantics treat space-separated terms as AND. For broader recall, join terms with `OR`: `"pagination OR cursor OR offset"`.

#### Filter Flags

When the playbook is large or the task is well-scoped, narrow the result set with filters. Filters are applied *after* FTS5 ranking, so match quality is preserved.

| Flag | Effect | Example |
|---|---|---|
| `--limit=N` | Cap the number of results (default 10) | `--limit=5` |
| `--min-importance=N` | Drop rows with importance < N (1-10 scale) | `--min-importance=7` |
| `--min-confidence=F` | Drop rows with confidence < F (0.0-1.0) | `--min-confidence=0.7` |
| `--category=NAME` | Exact category match (case-insensitive) | `--category=security` |
| `--tags=a,b,c` | Match if ANY listed tag is present | `--tags=repository,boundaries` |

Combine flags freely. A short, high-signal context window for an architecture refactor:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" semantic query "repository boundaries" \
  --category=architecture --min-importance=7 --limit=5
```

### Step 3: Evaluate Results

For each result:

- **Check confidence** — Low confidence lessons (< 0.5) are hypotheses, not facts
- **Check decay** — Lessons past their decay date may be stale
- **Check evidence** — Read the evidence field to understand the original context
- **Assess applicability** — Does the lesson apply to your current situation?

### Step 4: Apply or Discard

- **Applicable**: Use the lesson to inform your approach. Reference it in your work.
- **Partially applicable**: Extract the relevant principle, adapt to current context.
- **Not applicable**: Discard. A lesson about relational ORMs may not apply to a NoSQL situation.
- **Contradicts current understanding**: Investigate. Either the lesson is stale or your understanding needs updating.

## Fallback: No Database

If the FTS5 database does not exist yet (no `/devt:retro` has run), the CLI automatically falls back to keyword matching on .devt/learning-playbook.md. No manual intervention needed.

Concrete example — if you searched for "pagination cursor offset" via FTS5, the grep fallback equivalent is:

```bash
grep -i 'pagination\|cursor\|offset' .devt/learning-playbook.md
```

The CLI handles this translation automatically; you do not need to run grep yourself.

## Gate Functions

### Gate: Search Performed

- [ ] Query formulated with domain-specific terms
- [ ] Search executed (script or fallback)
- [ ] Results evaluated for applicability

## Anti-patterns

| Anti-pattern | Why it fails | Instead |
| --- | --- | --- |
| "I do not need to check -- this is new territory" | New territory is exactly when past lessons matter most | Search before starting unfamiliar work |
| "The search returned nothing useful" | A single query may miss relevant entries | Reformulate with different terms before concluding |
| "I already know the answer" | Unchecked confidence leads to repeated mistakes | Check anyway -- confirmation or contradiction both help |
| "Searching takes too long" | A 10-second search beats a 2-hour debugging session | Run the query before writing code |
| "The playbook is too small to be useful" | Even one relevant lesson justifies the search | Search regardless of playbook size |
| "I'll search if I get stuck" | By then you have already wasted time | Search before starting, not after failing |

## When NOT to Use

Skip when the task is completely new territory with no prior lessons (e.g., first time using a new framework). If the playbook has zero entries in the relevant domain, a search adds no value -- just proceed and capture lessons afterward via `/devt:retro`.

## Time Budget

- FTS5 query: instant
- Grep fallback: 1-2 seconds
- Evaluation: 30 seconds

## Integration

- **Prerequisites**: A learning playbook must exist (created by lesson-extraction)
- **CLI**: `devt-tools.cjs semantic query` (FTS5 search), `devt-tools.cjs semantic sync` (sync playbook to DB), `devt-tools.cjs semantic compact` (archive stale entries)
- **Used by agents**: All agents (before starting work)
- **Related skills**: lesson-extraction (populates the playbook), playbook-curation (maintains quality)
