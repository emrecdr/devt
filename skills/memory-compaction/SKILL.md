---
name: memory-compaction
description: Archive stale, low-value lessons from the learning playbook to reduce clutter and keep active entries high-signal. Identifies entries that have expired past their decay_days AND have low importance AND low confidence, then archives them (never deletes). Trigger on 'prune the playbook', 'archive old lessons', 'too many entries', 'stale lessons', 'cleanup playbook', 'compact the playbook', 'run compaction', 'run semantic compact', 'periodic maintenance on learning memory', 'playbook is too long', 'expired entries', 'entries past their decay date', 'technology change invalidated old lessons', 'switched from X to Y so old lessons are obsolete', 'dry-run compaction', 'what would get archived', or 'clean up before the new sprint'. Also trigger when the user mentions the playbook has grown large (100+ entries) or that search results are cluttered by old entries. Do NOT use for deduplicating/merging entries (use playbook-curation), adding new lessons (use lesson-extraction), searching the playbook (use semantic search), improving plugin rules/skills (use autoskill), or when the playbook is small (under 20 entries).
---

# Memory Compaction

## Overview

A learning playbook grows indefinitely without maintenance. Compaction archives lessons that have decayed past usefulness, keeping the active playbook focused on current, high-value knowledge.

Archived lessons are not deleted. They move to a separate archive where they remain searchable but do not clutter the active playbook.

## The Iron Law

```
ALL 3 ARCHIVAL CRITERIA MUST APPLY — NO SINGLE-FACTOR ARCHIVING
```

Archiving lessons too aggressively loses institutional knowledge that may become relevant again. Requiring all three criteria (age past decay date, low importance score, low confidence) ensures that only entries which are genuinely stale, unimportant, AND uncertain get archived. A lesson can be old but still important, or low-confidence but recent enough to verify — either case should survive compaction.

A lesson is archived only when age exceeds decay_days AND importance < 5 AND confidence < 0.5. Removing lessons by age alone destroys high-value knowledge.

## The Process

### Step 1: Identify Candidates

A lesson is a compaction candidate when ALL of the following are true:

- **Age exceeds decay_days**: The lesson has been in the playbook longer than its declared shelf life
- **Importance < 5**: The lesson is not high-impact enough to preserve indefinitely
- **Confidence < 0.5**: The lesson was never strongly validated

Lessons that meet only 1-2 criteria may still be valid. All 3 must apply.

**Example — archive vs renew:**

- **Archive**: Entry about a deprecated API workaround (age: 210 days, decay_days: 180, importance: 3, confidence: 0.4) — all 3 criteria met (age > decay, importance < 5, confidence < 0.5) → archive.
- **Renew**: Entry about a testing pattern for async handlers (age: 200 days, decay_days: 90, importance: 7, confidence: 0.3) — age and confidence qualify, but importance is too high (>= 5) → keep, but flag for review to gather stronger evidence and raise confidence.

### Step 2: Review Candidates

Before archiving, review each candidate:

- Is the lesson still relevant to the current project/stack?
- Has the lesson been referenced recently (check search logs if available)?
- Could the lesson prevent a future mistake that has not occurred yet?

If any answer is yes, renew the lesson (reset decay_days) rather than archiving.

### Step 3: Run Compaction

Use the CLI:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" semantic compact
```

Add `--dry-run` to preview without removing entries.

The command:

1. Queries the FTS5 database for entries matching all 3 compaction criteria
2. Removes archived entries from the database
3. Reports what was archived and what was kept

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

## When NOT to Use

Skip when the playbook has fewer than 20 entries — compaction adds overhead without benefit on small playbooks. At that size, manual review during curation is sufficient to keep quality high.

## Time Budget

- **Quick scan** (identify candidates, check criteria): 1-2 minutes
- **Full compaction with archival** (review, run CLI, verify results): 3-5 minutes

## Anti-patterns

| Anti-pattern | Why it fails | Instead |
| --- | --- | --- |
| "Archive everything older than X days" | Age alone is not sufficient criteria | Check all 3 criteria: age, importance, confidence |
| "The playbook is small enough, skip compaction" | Compaction is about quality, not just size | Review entry quality regardless of count |
| "Just delete the old ones" | History has value even when stale | Archive, do not delete |
| "All lessons are important" | If all are important, none are -- priorities become meaningless | Prioritize ruthlessly |
| "We might need it later" | That is why we archive instead of delete | Archive preserves access while reducing noise |
| "Compaction is maintenance busywork" | A cluttered playbook is more busywork than periodic cleanup | Schedule regular compaction cycles |

## Integration

- **Prerequisites**: A learning playbook with entries that have `decay_days` set
- **CLI**: `devt-tools.cjs semantic compact` (compaction), `devt-tools.cjs semantic compact --dry-run` (preview)
- **Used by agents**: curator (during maintenance cycles)
- **Related skills**: lesson-extraction (produces entries with decay_days), playbook-curation (quality gate before compaction)
