---
id: ADR-001
title: "Preflight sidecar exposes ONE governing surface: governing[] with lifecycle attached"
doc_type: decision
domain: preflight
status: active
confidence: verified
summary: "preflight-brief.json carries ONE governing-docs field: governing[] ({id,status,confidence}), lifecycle-filtered. Parallel governing_ids removed; K276 pins it dead at artifact + source layers."
affects_paths:
  - "bin/modules/preflight.cjs"
  - "scripts/smoke-test.sh"
links:
  - id: CON-004
    type: relates_to
  - id: REJ-002
    type: relates_to
created_at: "2026-07-17T00:00:00Z"
created_by: curator
schema_version: 1
---

# ADR-001: Preflight sidecar exposes ONE governing surface: `governing[]` with lifecycle attached

## Decision & Validated Reasoning

The Pre-Flight Brief sidecar (`preflight-brief.json`) carries exactly one governing-docs field: `governing: [{id, status, confidence}]` — the deduped union of lanes A–D ∪ G, lifecycle-filtered (status active|candidate only, REJ excluded by doc_type). Bare ids project via `[.governing[].id]`; membership checks use `[.governing[].id] | index("X") != null`. A parallel bare-id array (`governing_ids`) shipped briefly in v0.168.0 "so existing jq consumers keep working" and was removed same-day: a consumer inventory found ZERO consumers outside the suite's own gates — the compat pressure was assumed, not measured. The single field can grow enrichment (lane attribution, doc_type, an eventual trust score) with zero identity-consumer churn because there are no identity consumers. K276 pins the legacy field dead at both layers: artifact (`has("governing_ids") | not` on a generated sidecar) and source (string scan across product surfaces, catching `// []`-guarded soft consumers that would null-eval silently). Removal was chosen over reshaping-under-the-same-name deliberately: `jq -e` on a deleted field fails loud in CI; a reshaped field under the old name fails silent.
