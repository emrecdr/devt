---
id: REJ-002
title: "Do NOT add parallel compat fields to internal regenerated artifacts"
doc_type: rejected
domain: schema-evolution
status: active
confidence: verified
summary: "Never keep an old field alongside its replacement in ephemeral, regenerated, in-repo artifacts. No audience for the insurance — pure drift surface. Delete the name (fails loud) + keep-dead gate."
reason: maintainability
search_keywords:
  - "backward compat field"
  - "parallel field"
  - "compat alias"
  - "keep both fields"
  - "governing_ids"
affects_paths:
  - "bin/modules/preflight.cjs"
links:
  - id: CON-004
    type: relates_to
created_at: "2026-07-17T00:00:00Z"
created_by: curator
schema_version: 1
---

# Rejected: Do NOT add parallel compat fields to internal regenerated artifacts

## The Proposal & Why It Was Rejected

Rejected approach: when changing an internal artifact's schema (e.g. `preflight-brief.json`), keep the old field alongside the new one ("compat alias", "parallel field", "keep both so consumers don't break"). Proposed twice within one day — once by the implementing agent (shipped in v0.168.0 as `governing_ids` beside `governing[]`), once by an external reviewer with the strongest version of the argument (query-shape ergonomics + identity-vs-enrichment contract separation + parity gate to make the duplication safe). Rejected both times on the same ground: for an ephemeral, regenerated-per-run, internal artifact whose consumers are 100% in-repo and CI-gated, there is no audience for the insurance — the parallel field is pure drift surface requiring its own parity gate to stay honest, and the "temporary" alias trains future maintainers to see it as deletable legacy, guaranteeing eventual churn. The lean alternative shipped instead: single field, one migration commit editing every consumer (inventory first — there were zero), loud-fail property from deleting the name, and a keep-dead gate (K276) preventing resurrection.

## Reconsideration Triggers

Revisit only if the artifact gains external consumers or persisted data to migrate — at which point it is no longer in this class and CON-004's parallel-field branch applies.
