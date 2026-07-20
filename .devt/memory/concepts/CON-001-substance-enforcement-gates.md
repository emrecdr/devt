---
id: CON-001
title: Substance-Enforcement Gates
doc_type: concept
status: active
confidence: verified
domain: gates
summary: Gates must enforce substance (work happened), not form (artifact exists). Five field-validated instances; pattern is now structural to devt's workflow contract.
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

## Field-validated instances (7)

| Gate | Form check (passed) | Substance gap (bypassed) | Fix |
|---|---|---|---|
| **F4** | `graphify_scan_prep` step ran | Step was inside a skippable conditional | Move gate to mandatory precondition |
| **B4** | Curator dispatched | Dispatch was in an unreachable workflow branch | Relocate gate to context_init |
| **L1** | `dispatch-hygiene-guard.sh` warned | Advisory was ignored 6× in one session by same LLM | Default-block (`{decision:"deny"}`) |
| **F26** | `## Drill-down:` headings present | Headings hand-written without MCP calls | Cross-reference `_mcp-trace.jsonl` for `get_neighbors` records in `workflow_id` window |
| **F27/F28/F29/F30** | `review.md` / `impl-summary.md` exists | Body is "Stub written; analysis in progress." | `state check-agent-output` detects stub phrases + low word count + heading-only; wired into both `code-review.md` and `dev-workflow.md` verifier pre-gates AND into the verifier agent body itself for defense-in-depth |
| **C22F1** (cal #22) | `assert-graphify-decision` computed `under_three_drill_downs:true` | Field was informational only; `ok:true` returned despite F16 drill-down entirely skipped (0 get_neighbors calls + 0 drill-down sections, 5+ greenfield sessions over weeks) | Flip the gate: when `plan_tier ∈ {symbol_anchored, bulk_scoped}` AND `mcp_get_neighbors_calls === 0` AND `drillDownSections === 0`, return `ok:false`. Opt-out via `.devt/config.json::graphify_decision_mode: "warn"`. K114 locks the contract. |
| **C22F2** (cal #22) | Verifier returned `verdict: satisfied` with `criteria_total: 7` | Verifier walked rubric axes A–G and stopped — silently skipped axis H (`## Axis H — Dispatch warnings acknowledgment` added in v0.93.3 G3). The count was right (7 axes graded) but covered the wrong set (axes A–F+G instead of A–E+G+H). Coverage mismatch invisible to count-based gates. | Two-layer fix: (1) Verifier prompt prose mandates "walk EVERY axis declared in rubric, count by `^## Axis [A-Z] —` heading and `^\| **X.` table-row patterns"; (2) `state assert-verifier-graded-all-axes` post-hoc check counts rubric axes (both styles) and fails when `criteria_total < rubricAxesPresent`. K115 locks the contract. |

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
