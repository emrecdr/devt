---
id: LES-001
title: "String classes need scans, not sweeps"
doc_type: lesson
domain: docs-drift
status: active
confidence: verified
summary: "When a second 'complete' manual sweep is followed by new instances of the same stale string, stop counting instances and gate the class — with a pattern narrow enough to never false-positive."
affects_paths:
  - "scripts/smoke-test.sh"
created_at: "2026-07-17T00:00:00Z"
created_by: curator
schema_version: 1
---

# LES-001: String classes need scans, not sweeps

## Trigger, Action & Evidence

The Brief grew from 6 lanes to 8 (lanes G/H) and the stale count survived at 12 sites across README, CLAUDE.md, docs, commands, three workflows, both CLI usage surfaces, the MCP tool description, and the module's own docblock — in at least three string shapes ("6 lanes", "6-lane", "Lanes A-F"). Three successive manual sweeps (original author, external reviewer, follow-up validation) each terminated believing they were complete, and each was wrong — that is the signature of a string CLASS, not a string count. Rule: the second time a "complete" sweep is followed by new instances of the same stale string, stop counting instances and gate the class — with a pattern scoped narrowly enough that legitimate look-alikes (here: the 5-lane File Pre-Flight and a 5-lane render example, both genuinely different mechanisms) can never false-positive, because a gate that false-positives gets ignored and a gate that gets ignored is worse than no gate. Shipped as the K279 stale-lane-count scan. Suggested decay: 365 days — stable process principle, not volatile operational detail.
