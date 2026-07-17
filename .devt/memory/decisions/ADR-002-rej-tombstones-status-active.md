---
id: ADR-002
title: "REJ tombstones carry status: active; retrieval keys on doc_type, never on status"
doc_type: decision
domain: memory-layer
status: active
confidence: verified
summary: "REJ tombstones scaffold status: active — status describes the doc, not the approach. Every retrieval surface keys on doc_type='rejected', never status; a retracted tombstone gets status: superseded."
affects_paths:
  - ".devt/memory/rejected/**"
  - "templates/memory/REJ-template.md"
  - "bin/modules/memory.cjs"
  - "docs/MEMORY.md"
created_at: "2026-07-17T00:00:00Z"
created_by: curator
schema_version: 1
---

# ADR-002: REJ tombstones carry `status: active`; retrieval keys on doc_type, never on status

## Decision & Validated Reasoning

The rejection is a living rule — `status` describes the doc, not the approach — so REJ tombstones scaffold `status: active`. Field evidence for why the convention must be explicit: devt's own REJ-001 carried `active` while greenfield's REJ-001/REJ-002 carried `rejected`, a split created by the template (`status: rejected # always 'rejected' for REJ docs`) contradicting the docs. Behavior is identical either way because every retrieval surface keys on `doc_type='rejected'`: rejected_keywords indexing (memory.cjs), lane E matching, and the governing-union exclusion all ignore REJ status — so no migration was needed, only a canonical scaffold value. A tombstone that is itself retracted gets `status: superseded` like any other doc. The template now models the canonical value with the contract in the comment; docs/MEMORY.md §frontmatter carries the convention.
