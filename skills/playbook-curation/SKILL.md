---
name: playbook-curation
description: Use immediately after lesson-extraction to validate, deduplicate, and maintain the learning playbook. Actions — accept, merge, edit, reject, archive. Also trigger on 'clean up playbook', 'deduplicate lessons', 'the playbook is getting long', or during periodic maintenance when entries exceed 50.
---

# Playbook Curation

## Overview

A learning playbook degrades without curation. Duplicate entries accumulate, outdated lessons mislead, and low-quality entries dilute high-value ones. Curation keeps the playbook sharp and trustworthy.

The curator's job is not to grow the playbook. It is to maintain signal-to-noise ratio.

## The Iron Law

```
NO DUPLICATE OR CONTRADICTORY ENTRIES IN THE PLAYBOOK
```

Agents query the playbook for guidance before starting work. Duplicate entries create false emphasis (the lesson appears more important than it is), and contradictory entries force the agent to guess which is correct — often choosing whichever was loaded last. A curated playbook gives clear, unambiguous guidance; an uncurated one creates confusion proportional to its size.

Every new entry must be checked against existing entries. Duplicates dilute signal. Contradictions erode trust. The curator's job is quality, not volume.

## The Process

### Step 1: Review New Entries

For each new lesson entry, apply one of these actions:

#### Accept

The entry passes all quality filters (specific, generalizable, actionable, evidence-based) and adds new knowledge to the playbook.

- Verify the entry does not duplicate an existing lesson (Step 2)
- Confirm scores are calibrated (importance, confidence, decay_days)

#### Merge

The entry covers the same ground as an existing entry. Combine them:

- Keep the stronger description
- Use the higher importance score
- Average the confidence scores (weighted by evidence strength)
- Preserve all evidence from both entries
- Use the shorter decay period

#### Edit

The entry has valid content but poor expression. Improve it:

- Sharpen the description to be more specific or actionable
- Adjust scores that seem miscalibrated
- Add missing tags
- Fix category assignment

#### Reject

The entry fails one or more quality filters and cannot be improved:

- Too vague to be actionable
- Too specific to generalize
- No evidence to support the claim
- Describes a preference, not a lesson

#### Archive

The entry was once valid but is no longer relevant:

- The tool or framework version it references is no longer used
- The codebase pattern it addresses has been refactored away
- Its decay period has expired and it was not renewed

### Step 2: Check for Duplicates

Before accepting any new entry, search existing entries for:

- Same topic/domain (check tags)
- Same root lesson (different wording, same insight)
- Contradictory lessons (opposite advice for same situation)

If a duplicate is found, merge rather than add.

### Step 3: Resolve Contradictions

When two entries give opposite advice for the same situation:

1. Compare evidence — which has stronger, more recent evidence?
2. Check dates — has the context changed since the older entry?
3. **Newer wins if evidence is stronger** — update the old entry with new understanding
4. If both are valid in different contexts — merge into one entry that clarifies when each applies

Never leave contradictory entries unresolved. They undermine trust in the entire playbook.

**Concrete example:**

- **Entry A**: "Always mock external APIs in tests" (importance: 7, confidence: 0.8)
- **Entry B**: "Use real API calls for integration tests" (importance: 8, confidence: 0.9)
- **Resolution**: Both are valid — Entry A applies to unit tests, Entry B to integration tests. Edit both to specify their scope: Entry A becomes "Always mock external APIs in **unit** tests to isolate logic", Entry B becomes "Use real API calls in **integration** tests to verify contract compliance". No deletion needed, just scope clarification.

### Step 4: Prune Low-Value Entries

Periodically review entries with:

- Importance < 4 AND confidence < 0.5 — likely not worth keeping
- Decay expired AND no recent evidence — may be stale
- Tags that match no current project concerns — may be irrelevant

For each, decide: renew (reset decay), archive, or delete.

## Gate Functions

### Gate: No Duplicates Added

- [ ] Every accepted entry checked against existing playbook
- [ ] Duplicates merged, not added as new

### Gate: Contradictions Resolved

- [ ] No two entries give opposite advice for the same situation
- [ ] When contradiction found, resolved by evidence comparison

### Gate: Quality Maintained

- [ ] No entry accepted that fails quality filters
- [ ] Scores are calibrated (not all 10/1.0, not all 1/0.1)

## When NOT to Use

Skip when only adding new entries — lesson-extraction handles that. Use this skill for maintenance and cleanup: deduplication, contradiction resolution, score recalibration, and pruning. If the playbook was just created or has only a handful of entries with no overlaps, curation adds no value yet.

## Time Budget

- **Quick review** (check new entries against existing, spot duplicates): 2-3 minutes
- **Full curation with dedup** (review all entries, resolve contradictions, prune stale): 5-8 minutes

## Anti-patterns

| Anti-pattern | Why it fails | Instead |
| --- | --- | --- |
| "Just add it, we'll clean up later" | Later means never | Curate at the point of entry |
| "This contradicts an existing entry but both seem right" | Ambiguity is debt that undermines trust | Resolve by comparing evidence and context |
| "The playbook is too long to review" | That is exactly when curation is most needed | Prioritize curation when the playbook grows |
| "More entries = better playbook" | More noise = worse playbook | Quality over quantity |
| "Removing entries loses knowledge" | Archiving preserves knowledge while reducing noise | Archive, do not delete |
| "The duplicate is slightly different" | If the actionable advice is the same, it is a duplicate | Merge into the stronger entry |
| "I'm not sure if it's stale" | If you cannot find recent evidence, it is stale | Archive and renew only if new evidence appears |

## Integration

- **Prerequisites**: lesson-extraction (produces entries to curate)
- **Feeds into**: semantic-search (curated playbook is the search corpus)
- **Used by agents**: curator (primary), retro (post-extraction curation)
- **Related skills**: lesson-extraction (produces raw entries), memory-compaction (bulk archival of stale entries)
