---
id: CON-001
title: Substance-Enforcement Gates
doc_type: concept
status: active
confidence: verified
domain: gates
summary: Gates must enforce substance (work happened), not form (artifact exists). Five field-validated instances; pattern is now structural to devt's workflow contract.
keywords:
  - substance
  - enforcement
  - gate
  - verifier
  - workflow-contract
  - stub-detection
  - mcp-trace
affects_paths:
  - bin/modules/state.cjs
  - workflows/code-review.md
  - workflows/dev-workflow.md
  - agents/verifier.md
  - hooks/dispatch-hygiene-guard.sh
created_at: 2026-05-27
created_by: emre
schema_version: 1
---

# Substance-Enforcement Gates

A recurring devt failure mode: gates verify an artifact exists, has the right shape, or has the right section count — but not whether the **substance** behind the form is real. LLM orchestrators under context pressure classify advisory warnings as "not load-bearing" and skip them; soft signals lose to perceived urgency every time. Only gates that block involuntarily have observed efficacy.

## Field-validated instances (5)

| Gate | Form check (passed) | Substance gap (bypassed) | Fix |
|---|---|---|---|
| **F4** | `graphify_scan_prep` step ran | Step was inside a skippable conditional | Move gate to mandatory precondition |
| **B4** | Curator dispatched | Dispatch was in an unreachable workflow branch | Relocate gate to context_init |
| **L1** | `dispatch-hygiene-guard.sh` warned | Advisory was ignored 6× in one session by same LLM | Default-block (`{decision:"deny"}`) |
| **F26** | `## Drill-down:` headings present | Headings hand-written without MCP calls | Cross-reference `_mcp-trace.jsonl` for `get_neighbors` records in `workflow_id` window |
| **F27/F28/F29/F30** | `review.md` / `impl-summary.md` exists | Body is "Stub written; analysis in progress." | `state check-agent-output` detects stub phrases + low word count + heading-only; wired into both `code-review.md` and `dev-workflow.md` verifier pre-gates AND into the verifier agent body itself for defense-in-depth |

## How to recognize the class

When adding a new gate, ask: **does this check the artifact's shape, or the work behind it?** If shape alone, identify a substance signal:

- **MCP-backed work** — cross-reference `_mcp-trace.jsonl` records scoped to the current `workflow_id` (the trace is the receipt). Reference impl: `state.cjs::assertGraphifyDecision`.
- **Agent-authored content** — run `state check-agent-output` against the output file. Wire the call as a bash pre-gate before the verifier dispatch AND inside the verifier agent body.
- **Multi-step work where one step is skippable** — relocate the gate to a mandatory step (the F4 lesson).

## Audit test

When reviewing a devt gate, ask: *if I remove the substance check, can a well-intentioned orchestrator still pass by writing prose / creating an empty file / running through the form?* If yes, the gate enforces form not substance.

## Why fail-closed, not advisory

The L1 incident proved field efficacy: the same LLM dismissed 6 consecutive advisory warnings in one session with explicit self-report that informational signals get classified as "not load-bearing." Substance gates that emit warnings instead of blocking provide zero observed protection. Pattern across all 5 instances: counterweights only work when the orchestrator cannot route around them.

## Related

- `docs/INTERNALS.md::Substance-Enforcement Gates` — fuller architectural narrative
- `CHANGELOG.md` entries for v0.55.x (F4/B4), v0.58.0 (L1), v0.58.1 (F26/F27), v0.58.2 (F28), v0.58.3 (F29/F30/F31)
