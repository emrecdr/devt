---
id: CON-004
title: "Contract-breaking rule: internal ephemeral artifacts break cleanly; external or persisted contracts earn parallel fields"
doc_type: concept
domain: schema-evolution
status: active
confidence: verified
summary: "Break in place when the legacy shape lies; DELETE (never reshape) when removing — deleted names fail loud; parallel fields only for external/persisted contracts. Inventory consumers first."
affects_paths:
  - "bin/modules/preflight.cjs"
links:
  - id: ADR-001
    type: relates_to
  - id: REJ-002
    type: relates_to
created_at: "2026-07-17T00:00:00Z"
created_by: curator
schema_version: 1
---

# Concept: Contract-breaking rule — internal ephemeral artifacts break cleanly; external or persisted contracts earn parallel fields

## Definition & Logic

Two data points from the same codebase fix the principle. (1) `suggested_reading` was broken IN PLACE (flat array → `{files, symbols}`) because the old shape lied — it mixed navigable paths with bare symbol labels, actively misleading consumers. (2) `governing_ids` was DELETED outright when `governing[]` replaced it, because `preflight-brief.json` is an ephemeral, regenerated-per-run, internal artifact: one owner holds every consumer, CI gates hold the contract, there is no external audience and no persisted data to migrate — parallel-field "insurance" insures nothing while creating a parity-drift surface that needs its own gate. The rule: break in place when the legacy shape lies; break by DELETION (not reshaping) when removing — a deleted name fails loud (`jq -e` exits nonzero), a reshaped name fails silent; and reserve parallel fields for contracts with external consumers or persisted data. Prerequisite in all cases: inventory consumers with grep BEFORE claiming compat pressure — the governing_ids "live jq consumers" turned out to be zero.
