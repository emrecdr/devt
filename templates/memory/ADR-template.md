---
id: ADR-000
title: "Decision Title"
doc_type: decision
domain: "general"
status: candidate              # candidate | active | superseded
confidence: explicit           # verified | explicit | inferred | observed | speculative
summary: "One-sentence summary, ≤ 200 chars, used as the FTS5 indexed surface for high-speed search."
affects_paths:
  - "src/module/**"
affects_symbols:
  - SymbolName
  # Or with Graphify-validated binding:
  # - symbol: SymbolName
  #   binding_confidence: EXTRACTED   # EXTRACTED | INFERRED | AMBIGUOUS
links:
  # Cross-references to related docs. Forward references are allowed.
  # - id: ADR-001
  #   type: depends_on            # supersedes | depends_on | implements | relates_to
created_at: "2026-01-01T00:00:00Z"
created_by: user                 # user | curator | retro | council | manual
schema_version: 1
---

# ADR-000: Decision Title

## Context

What problem are we solving? What constraints apply? What is the prior state of the
codebase or the design space we're operating in?

## Decision

The specific rule, library choice, pattern, or architectural commitment we are making.
Use prescriptive language: "We will use Argon2 for password hashing" — not "consider
Argon2."

## Validated Reasoning

Why this choice over alternatives? Cite evidence:
- Codebase pattern observed (e.g., "applied in 4/5 services")
- External constraint (compliance, performance benchmark, library limitation)
- Prior incident or post-mortem (link to lessons playbook entry if applicable)

Each reasoning point should be grounded in something verifiable, not pure preference.

## Consequences

What changes for developers as a result? What is now forbidden? What new responsibilities
are introduced? What follow-up work does this enable or block?

## Alternatives Considered (and Why Rejected)

Brief notes on the options that were not chosen. If an alternative becomes a permanent
"do not propose this" decision, also create a corresponding REJ-xxx tombstone with
search_keywords so AI re-proposals are suppressed.
