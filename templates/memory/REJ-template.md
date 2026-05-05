---
id: REJ-000
title: "Rejected Idea"
doc_type: rejected
domain: "general"
status: rejected               # always 'rejected' for REJ docs
confidence: explicit
summary: "What we are NOT doing and why. ≤ 200 chars."
reason: user_preference        # user_preference | performance | security | maintainability | compliance | complexity
search_keywords:
  # Phrases that suppress AI re-proposal of this idea. CRITICAL for the tombstone
  # mechanism — without keywords, this REJ cannot prevent re-proposals.
  - "search phrase 1"
  - "search phrase 2"
affects_paths:
  - "src/**"
created_at: "2026-01-01T00:00:00Z"
created_by: user
schema_version: 1
---

# Rejected: Title

## The Proposal

What was the original idea? Brief summary of what was suggested or considered. Include
enough detail that a future agent can recognize the same proposal in different wording.

## Why it was Rejected

Detailed technical / business reasoning for the rejection. Be specific so the rejection
holds up under future reconsideration. Cite evidence:

- Benchmarks, profiling data
- Compliance / audit requirements
- Past incident or failure
- Conflicting active ADR (link via `[[ADR-xxx]]`)

If the rejection is conditional ("we'd revisit if X changes"), say so here.

## Search Keywords for AI Suppression

The `search_keywords` field in frontmatter contains phrases the discovery engine and
autoskill skill query before proposing changes. If an agent's reasoning contains these
phrases, the proposal is suppressed silently. Add every reasonable phrasing of the
rejected idea — over-specificity in one keyword is fine; under-coverage means the AI
will eventually re-propose this.

## Reconsideration Triggers

If something changes that would make us revisit this rejection, document the trigger
here. Examples:
- "Graphify benchmark shows >10x improvement on our query patterns"
- "Compliance team approves storage in non-encrypted KV stores"

If no trigger applies, write "Permanent rejection — no foreseeable conditions reverse this."
