---
id: ADR-003
title: "Agent Teams adoption is deferred behind named native-convergence triggers"
doc_type: decision
domain: platform-alignment
status: active
confidence: explicit
summary: "No Agent Teams adoption while experimental + non-resumable; file-based state is load-bearing for /devt:next resume. Lane fan-out stays canonical until teams gain resume and exit experimental."
affects_paths:
  - "workflows/code-review-parallel.md"
  - "bin/modules/state-lanes.cjs"
  - "bin/modules/dispatch.cjs"
  - "docs/RETIREMENT-WATCH.md"
created_at: "2026-07-26T00:00:00Z"
created_by: user
schema_version: 1
---

# ADR-003: Agent Teams adoption is deferred behind named native-convergence triggers

## Decision & Validated Reasoning

devt keeps its own coordination machinery — lane registration/fan-out, dispatch envelopes, the consolidator contract — and does NOT migrate to Claude Code Agent Teams while the feature is experimental. The blocking property is resume: teams sessions are not `/resume`-restorable and teammate handles die at compaction/session boundaries, while devt's file-based state is load-bearing for `/devt:next` + `/devt:pause` (the same ground on which the Anthropic specialist-team sub-conversation pattern was rejected — see AGENT-CONTRACTS "Rejected Patterns"). Adopting a coordination primitive that cannot survive the session boundary would trade a working resume contract for platform alignment that north star 4 only endorses when the platform path actually covers the contract. The freeze-zone policy applies in both directions: no NEW devt machinery in the areas teams is converging on (shared task lists, delegate routing) without a field receipt the native path cannot serve, and no adoption before the trigger fires.

## Consequences

Parallel review stays on `code-review-parallel.md` lanes; `TeammateIdle`/`TaskCompleted`-style coordination is not wired. The RETIREMENT-WATCH native-convergence table is the standing tripwire — its trigger row ("teams gain resume + exit experimental") names the reconsideration condition, at which point the lane machinery becomes a retirement candidate, not a parallel survivor.
