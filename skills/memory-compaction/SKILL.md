---
name: memory-compaction
description: Use for periodic maintenance when the learning playbook exceeds 100 entries or contains stale lessons. Archives low-importance, low-confidence lessons past their decay date. Also trigger on 'prune the playbook', 'archive old lessons', 'too many lessons', or after a major technology change that invalidates older entries.
---

# Memory Compaction

## Overview

A learning playbook grows indefinitely without maintenance. Compaction archives lessons that have decayed past usefulness, keeping the active playbook focused on current, high-value knowledge.

Archived lessons are not deleted. They move to a separate archive where they remain searchable but do not clutter the active playbook.

## When to Use

- Monthly maintenance cycle
- When the playbook exceeds 100 active entries
- When search results consistently include stale or irrelevant entries
- After a major technology or architecture change that invalidates older lessons

## The Process

### Step 1: Identify Candidates

A lesson is a compaction candidate when ALL of the following are true:

- **Age exceeds decay_days**: The lesson has been in the playbook longer than its declared shelf life
- **Importance < 5**: The lesson is not high-impact enough to preserve indefinitely
- **Confidence < 0.5**: The lesson was never strongly validated

Lessons that meet only 1-2 criteria may still be valid. All 3 must apply.

### Step 2: Review Candidates

Before archiving, review each candidate:

- Is the lesson still relevant to the current project/stack?
- Has the lesson been referenced recently (check search logs if available)?
- Could the lesson prevent a future mistake that has not occurred yet?

If any answer is yes, renew the lesson (reset decay_days) rather than archiving.

### Step 3: Run Compaction

Use the compaction script:

```bash
python scripts/compact.py
```

The script:
1. Reads the active playbook
2. Identifies entries matching all 3 compaction criteria
3. Moves them to the archive file
4. Reports what was archived and what was kept

### Step 4: Verify Results

After compaction:

- [ ] Active playbook size reduced
- [ ] Archived entries are accessible in the archive file
- [ ] No high-importance lessons were accidentally archived
- [ ] The active playbook still covers all major project domains

## Gate Functions

### Gate: Criteria Met

- [ ] All 3 criteria checked for each candidate (age, importance, confidence)
- [ ] Candidates meeting only 1-2 criteria were not archived

### Gate: No Valuable Lessons Lost

- [ ] Each archived entry reviewed before archival
- [ ] High-importance lessons (>= 7) are never auto-archived regardless of age
- [ ] Recently referenced lessons are renewed, not archived

## Red Flags — STOP

- "Archive everything older than X days" — Age alone is not sufficient. Check importance and confidence.
- "The playbook is small enough, skip compaction" — Compaction is about quality, not just size.
- "Just delete the old ones" — Archive, do not delete. History has value.

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "All lessons are important" | If all lessons are important, none are. Prioritize. |
| "We might need it later" | That is why we archive (preserve) instead of delete |
| "Compaction is maintenance busywork" | A cluttered playbook is more busywork than periodic cleanup |

## Integration

- **Prerequisites**: A learning playbook with entries that have `decay_days` set
- **Scripts**: `scripts/compact.py` (compaction tool)
- **Used by agents**: curator (during maintenance cycles)
- **Related skills**: lesson-extraction (produces entries with decay_days), playbook-curation (quality gate before compaction)
